"use client";
import { BRAND } from "@/lib/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "./Theme";
import { clock } from "@/lib/format";
import { silentRuns } from "@/lib/metrics";
import type { CodeSnapshot, TimelineEvent } from "@/lib/types";

// A ledger decision pinned at the time its line was written. "partial": said what, not why.
export type Moment = { key: string; t: number; label: string; state: "explained" | "partial" | "never"; redo?: boolean };
export type Mismatch = { t: number; label: string }; // a said-vs-did item, at the time it was said

const NARRATED_MS = 6000; // speech this close to an edit counts as narrating it (as in lib/metrics.ts): amber
const SILENT_MS = 15000; // this long from any speech is fully silent (the metrics' silent-stretch gap): red
const HEAT_STEP_MS = 1000; // how finely the typing lane's colour is sampled
const PIN_MARK = { explained: "✓", partial: "⚑", never: "⚑" };
const PIN_TITLE = { explained: "Explained", partial: "Said what, not why", never: "Never explained" };
const RATES = [1, 1.5, 2];
const MIC_SEEK_MS = 150; // how often a drag on the timeline may re-seek the recording

// Green → amber → red for v from 0 (good) to 1 (bad), mixed from the theme tokens.
export function heat(v: number) {
  const c = Math.min(1, Math.max(0, v));
  return c < 0.5
    ? `color-mix(in oklab, var(--heat-mid) ${Math.round(c * 200)}%, var(--green))`
    : `color-mix(in oklab, var(--red) ${Math.round((c - 0.5) * 200)}%, var(--heat-mid))`;
}

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
  mismatches: Mismatch[];
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
  const micSeekRef = useRef(0); // when a drag last moved the recording, to throttle it

  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const micTime = (ms: number) => Math.max(0, (ms - audioOffsetMs) / 1000);

  const seekTo = (ms: number, syncMic = true) => {
    const next = Math.min(durationMs, Math.max(0, ms));
    tRef.current = next;
    setT(next);
    voiceRef.current?.pause();
    if (syncMic && micRef.current) micRef.current.currentTime = micTime(next);
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
  // The same un-narrated stretches the metrics count; they only carry the tooltip now.
  const silent = useMemo(() => silentRuns(timeline, editTimes).runs.filter((r) => r.end > r.start), [timeline, editTimes]);

  // How long before or after `ms` the candidate last spoke or next speaks, mapped onto the
  // colour scale: 0 while talking, 0.5 at NARRATED_MS, 1 at SILENT_MS and beyond.
  const quiet = (ms: number) => {
    let gap = Infinity;
    for (const e of timeline) {
      if (e.type === "speech") gap = Math.min(gap, ms < e.start ? e.start - ms : ms > e.end ? ms - e.end : 0);
    }
    return gap <= NARRATED_MS ? gap / NARRATED_MS / 2 : 0.5 + (gap - NARRATED_MS) / (SILENT_MS - NARRATED_MS) / 2;
  };
  // One typing burst as a gradient with a colour stop every HEAT_STEP_MS.
  const burstFill = (b: { start: number; end: number }) => {
    const len = b.end - b.start;
    if (len < HEAT_STEP_MS) return heat(quiet(b.start));
    const stops: string[] = [];
    for (let ms = b.start; ms < b.end; ms += HEAT_STEP_MS) stops.push(`${heat(quiet(ms))} ${(((ms - b.start) / len) * 100).toFixed(1)}%`);
    stops.push(`${heat(quiet(b.end))} 100%`);
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  };

  const startOf = (e: TimelineEvent) => (e.type === "speech" ? e.start : e.t);
  let active = -1;
  timeline.forEach((e, i) => {
    if (startOf(e) <= t) active = i;
  });
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Press to seek, hold and move to scrub. The pointer is captured, so the drag
  // carries on outside the track. The recording is re-seeked at most every
  // MIC_SEEK_MS while dragging, and once more on release.
  const scrub = (ev: React.PointerEvent<HTMLDivElement>, syncMic: boolean) => {
    const r = ev.currentTarget.getBoundingClientRect();
    if (syncMic) micSeekRef.current = performance.now();
    seekTo(((ev.clientX - r.left) / r.width) * durationMs, syncMic);
  };
  const onTrackDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    scrub(ev, true);
  };
  const onTrackMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) return;
    scrub(ev, performance.now() - micSeekRef.current > MIC_SEEK_MS);
  };
  const onTrackUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) return;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    if (micRef.current) micRef.current.currentTime = micTime(tRef.current);
  };

  const todo = moments.filter((m) => m.redo); // skipped the first time; stays listed, in green, once a retake explains it

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

      <div className="track" onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={onTrackUp}>
        <div className="lane">
          <span className="lane-name">You</span>
          {timeline.map((e, i) => e.type === "speech" && (
            <i key={i} className="seg you" title={e.text} style={{ left: pct(e.start), width: pct(Math.max(800, e.end - e.start)) }} />
          ))}
        </div>
        <div className="lane">
          <span className="lane-name">{BRAND.interviewer}</span>
          {timeline.map((e, i) => e.type === "interviewer" && (
            <i key={i} className="seg ai" title={e.text} style={{ left: pct(e.t), width: pct(Math.max(1500, e.text.split(/\s+/).length * 380)) }} />
          ))}
        </div>
        <div className="lane">
          <span className="lane-name">Typing</span>
          {typing.map((b, i) => (
            <i key={i} className="seg heat" style={{ left: pct(b.start), width: pct(Math.max(600, b.end - b.start)), background: burstFill(b) }} />
          ))}
          {silent.map((r, i) => (
            <i key={`s${i}`} className="seg quiet" title={`Typed for ${Math.round((r.end - r.start) / 1000)}s without talking`} style={{ left: pct(r.start), width: pct(r.end - r.start) }} />
          ))}
          {timeline.map((e, i) => e.type === "run" && (
            <b key={i} className={`pin run ${e.passed === e.total ? "pass" : "fail"}`} title={`Ran code: ${e.summary}`} style={{ left: pct(e.t) }}>▶</b>
          ))}
        </div>
        {moments.map((m) => (
          <b key={m.key} className={`pin flag ${m.state}`} title={`${PIN_TITLE[m.state]}: ${m.label}`} style={{ left: pct(m.t) }}>{PIN_MARK[m.state]}</b>
        ))}
        {props.mismatches.map((x, i) => (
          <b key={i} className="pin flag" title={`Said vs did: ${x.label}`} style={{ left: pct(x.t) }}>≠</b>
        ))}
        <div className="playhead" style={{ left: pct(t) }} />
      </div>
      <div className="legend muted small">
        <span><i className="seg you" /> you talking</span>
        <span><i className="seg ai" /> {BRAND.interviewer}</span>
        <span><i className="seg heat" /> typing: narrated → silent</span>
        <span>▶ test run</span>
        <span><b className="flag explained">✓</b> explained</span>
        <span><b className="flag partial">⚑</b> said what, not why</span>
        <span><b className="flag">⚑</b> never explained</span>
        <span><b className="flag">≠</b> said vs did</span>
      </div>

      {todo.length > 0 && (
        <div className="moments">
          {todo.map((m) => (
            <div key={m.key} className={`moment ${m.state}`}>
              <b className={`flag ${m.state}`}>{PIN_MARK[m.state]}</b>
              <button className="link" onClick={() => seekTo(m.t - 3000)}>{clock(m.t)}</button>
              <span>{m.label}{m.state === "explained" && <span className="pass small"> · explained on your retake</span>}</span>
              <button onClick={() => { setPlaying(false); props.onRedoMoment(m.key); }}>↺ {m.state === "explained" ? "Redo again" : "Redo this moment"}</button>
            </div>
          ))}
        </div>
      )}

      <div className="replay-body">
        <div className="replay-code">
          <CodeEditor
            language="python"
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
              {e.type === "run" ? <i>Ran code: {e.summary}</i> : <><b>{e.type === "speech" ? "You" : BRAND.interviewer}</b> {e.text}</>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
