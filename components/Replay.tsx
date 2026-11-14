"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { clock } from "@/lib/format";
import { silentRuns } from "@/lib/metrics";
import type { CodeSnapshot, TimelineEvent } from "@/lib/types";

export type Moment = { key: string; t: number; label: string };

const MIN_SILENT_MS = 8000; // shortest silent-coding stretch worth marking
const RATES = [1, 1.5, 2];

export function snapshotAt(history: CodeSnapshot[], t: number) {
  let code = history[0]?.code ?? "";
  for (const s of history) {
    if (s.t > t) break;
    code = s.code;
  }
  return code;
}

// Scrubbable replay of the session: code, transcript and audio move together.
export default function Replay(props: {
  timeline: TimelineEvent[];
  codeHistory: CodeSnapshot[];
  durationMs: number;
  audioUrl: string | null;
  audioOffsetMs: number;
  moments: Moment[];
  seek: { t: number; n: number } | null; // set by the parent to jump somewhere
  onRedoMoment: (key: string) => void;
  onRedoAt: (t: number) => void;
}) {
  const { timeline, codeHistory, durationMs, audioUrl, audioOffsetMs, moments } = props;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const tRef = useRef(0);
  const micRef = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const micTime = (ms: number) => Math.max(0, (ms - audioOffsetMs) / 1000);

  const seekTo = (ms: number) => {
    const next = Math.min(durationMs, Math.max(0, ms));
    tRef.current = next;
    setT(next);
    voiceRef.current?.pause();
    if (micRef.current) micRef.current.currentTime = micTime(next);
  };

  useEffect(() => {
    if (props.seek) seekTo(props.seek.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seek]);

  // Our own clock drives the replay, so it works with or without a recording.
  useEffect(() => {
    if (!playing) return;
    if (tRef.current >= durationMs) seekTo(0);
    const mic = micRef.current;
    if (mic) {
      mic.playbackRate = rate;
      mic.currentTime = micTime(tRef.current);
      mic.play().catch(() => {});
    }
    let last = performance.now();
    let shown = tRef.current;
    let raf = 0;
    const step = (ts: number) => {
      const prev = tRef.current;
      let next = prev + (ts - last) * rate;
      last = ts;
      // play the interviewer's lines as the playhead reaches them
      for (const e of timeline) {
        if (e.type === "interviewer" && e.audioUrl && e.t >= prev && e.t < next) {
          voiceRef.current?.pause();
          voiceRef.current = new Audio(e.audioUrl);
          voiceRef.current.playbackRate = rate;
          voiceRef.current.play().catch(() => {});
        }
      }
      if (next >= durationMs) {
        next = durationMs;
        setPlaying(false);
      }
      tRef.current = next;
      if (Math.abs(next - shown) > 100 || next === durationMs) {
        shown = next;
        setT(next);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      mic?.pause();
      voiceRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate]);

  const editTimes = useMemo(() => codeHistory.slice(1).map((s) => s.t), [codeHistory]);
  const typing = useMemo(() => {
    const bursts: { start: number; end: number }[] = [];
    for (const et of editTimes) {
      const b = bursts[bursts.length - 1];
      if (b && et - b.end < 4000) b.end = et;
      else bursts.push({ start: et, end: et });
    }
    return bursts;
  }, [editTimes]);
  const silent = useMemo(
    () => silentRuns(timeline, editTimes).runs.filter((r) => r.end - r.start >= MIN_SILENT_MS),
    [timeline, editTimes]
  );

  const startOf = (e: TimelineEvent) => (e.type === "speech" ? e.start : e.t);
  let active = -1;
  timeline.forEach((e, i) => {
    if (startOf(e) <= t) active = i;
  });
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onTrackClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    seekTo(((ev.clientX - r.left) / r.width) * durationMs);
  };

  return (
    <div className="replay">
      {audioUrl && (
        <audio
          ref={micRef}
          src={audioUrl}
          preload="auto"
          // Chrome reports recorded audio as endless until it is seeked once; this makes it seekable.
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (a.duration === Infinity) {
              a.currentTime = 1e9;
              a.ontimeupdate = () => {
                a.ontimeupdate = null;
                a.currentTime = micTime(tRef.current);
              };
            }
          }}
        />
      )}

      <div className="replay-controls">
        <button className="primary small" onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        <span className="timer">{clock(t)} / {clock(durationMs)}</span>
        {RATES.map((r) => (
          <button key={r} className={rate === r ? "on" : ""} onClick={() => setRate(r)}>{r}×</button>
        ))}
        <span className="spacer" />
        {!audioUrl && <span className="muted small">No recording for this session; code and transcript only.</span>}
        <button onClick={() => { setPlaying(false); props.onRedoAt(tRef.current); }}>↺ Redo from here</button>
      </div>

      <div className="track" onClick={onTrackClick}>
        <div className="lane">
          <span className="lane-name">You</span>
          {timeline.map((e, i) => e.type === "speech" && (
            <i key={i} className="seg you" title={e.text} style={{ left: pct(e.start), width: pct(Math.max(800, e.end - e.start)) }} />
          ))}
        </div>
        <div className="lane">
          <span className="lane-name">Interviewer</span>
          {timeline.map((e, i) => e.type === "interviewer" && (
            <i key={i} className={`seg ai ${e.kind}`} title={e.text} style={{ left: pct(e.t), width: pct(Math.max(1500, e.text.split(/\s+/).length * 380)) }} />
          ))}
        </div>
        <div className="lane">
          <span className="lane-name">Typing</span>
          {typing.map((b, i) => (
            <i key={i} className="seg typing" style={{ left: pct(b.start), width: pct(Math.max(600, b.end - b.start)) }} />
          ))}
          {silent.map((r, i) => (
            <i key={`s${i}`} className="seg silent" title={`Typed for ${Math.round((r.end - r.start) / 1000)}s without talking`} style={{ left: pct(r.start), width: pct(r.end - r.start) }} />
          ))}
          {timeline.map((e, i) => e.type === "run" && (
            <b key={i} className={`pin run ${e.passed === e.total ? "pass" : "fail"}`} title={`Ran code: ${e.summary}`} style={{ left: pct(e.t) }}>▶</b>
          ))}
        </div>
        {moments.map((m) => (
          <b key={m.key} className="pin flag" title={`Unexplained: ${m.label}`} style={{ left: pct(m.t) }}>⚑</b>
        ))}
        <div className="playhead" style={{ left: pct(t) }} />
      </div>
      <div className="legend muted small">
        <span><i className="seg you" /> you talking</span>
        <span><i className="seg ai" /> interviewer</span>
        <span><i className="seg ai probe" /> probe</span>
        <span><i className="seg typing" /> typing</span>
        <span><i className="seg silent" /> typing in silence</span>
        <span><b className="flag">⚑</b> unexplained decision</span>
      </div>

      {moments.length > 0 && (
        <div className="moments">
          {moments.map((m) => (
            <div key={m.key} className="moment">
              <b className="flag">⚑</b>
              <button className="link" onClick={() => seekTo(m.t - 3000)}>{clock(m.t)}</button>
              <span>{m.label}</span>
              <button onClick={() => { setPlaying(false); props.onRedoMoment(m.key); }}>↺ Redo this moment</button>
            </div>
          ))}
        </div>
      )}

      <div className="replay-body">
        <div className="replay-code">
          <Editor
            language="python"
            theme="vs-dark"
            value={snapshotAt(codeHistory, t)}
            options={{ readOnly: true, fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, domReadOnly: true }}
          />
        </div>
        <div className="replay-log">
          {timeline.map((e, i) => (
            <div
              key={i}
              ref={i === active ? activeRef : undefined}
              className={`line ${e.type} ${i === active ? "active" : ""} ${startOf(e) > t ? "future" : ""}`}
              onClick={() => seekTo(startOf(e))}
            >
              <span className="muted">{clock(startOf(e))}</span>{" "}
              {e.type === "run" ? <i>Ran code: {e.summary}</i> : <><b>{e.type === "speech" ? "You" : "Interviewer"}</b> {e.text}</>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
