"use client";
import { useEffect, useRef, useState } from "react";
import { clock } from "@/lib/format";
import { fillerBreakdown } from "@/lib/metrics";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import type { RedoResult, RedoTarget } from "@/lib/types";

const MAX_SECONDS = 45;

// Model answer text -> its audio (a blob URL, or null for "use the browser voice").
// Kept outside the component so a clip is fetched once, even if the card is reopened.
const clips = new Map<string, Promise<string | null>>();

function fetchClip(text: string) {
  let clip = clips.get(text);
  if (!clip) {
    clip = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20000),
    })
      .then(async (res) => (res.status === 200 ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    clips.set(text, clip);
    // nothing to keep when there is no premium voice; ask again next time
    clip.then((url) => !url && clips.delete(text));
  }
  return clip;
}

// Re-explain one moment out loud and get it graded against the first attempt.
export default function Redo(props: {
  problemId: string;
  target: RedoTarget;
  attempts: RedoResult[];
  onResult: (r: RedoResult) => void;
  onClose: () => void;
}) {
  const { target, attempts } = props;
  const [status, setStatus] = useState<"idle" | "recording" | "grading">("idle");
  const [said, setSaid] = useState("");
  const [left, setLeft] = useState(MAX_SECONDS);
  const [error, setError] = useState("");
  const saidRef = useRef("");
  const startedRef = useRef(0);
  const mutedRef = useRef(false);
  const [hear, setHear] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null); // held so Chrome doesn't drop it mid-speech
  const hearRef = useRef(0); // bumped on every play/stop, so an outdated one does nothing

  const stopHearing = () => {
    hearRef.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    speechSynthesis.cancel();
    setHear("idle");
  };
  // Speaks the model answer in the interviewer's voice (browser voice if there is no premium one).
  const hearIt = async (text: string) => {
    stopHearing();
    const id = hearRef.current;
    setHear("loading");
    const url = await fetchClip(text);
    if (id !== hearRef.current) return;
    setHear("playing");
    const done = () => {
      if (id === hearRef.current) setHear("idle");
    };
    if (url) {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = audio.onerror = done;
      audio.play().catch(done);
    } else {
      const u = new SpeechSynthesisUtterance(text);
      utterRef.current = u;
      u.rate = 1.05;
      u.onend = u.onerror = done;
      speechSynthesis.speak(u);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stopHearing, []);

  const stt = useSpeechRecognition(
    {
      onFinal: (text) => {
        saidRef.current = `${saidRef.current} ${text}`.trim();
        setSaid(saidRef.current);
      },
      onActivity: () => {},
    },
    mutedRef
  );

  const grade = async (retake: string, seconds: number, spoken: boolean) => {
    stopHearing();
    setStatus("grading");
    setError("");
    try {
      const res = await fetch("/api/redo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, retake, problemId: props.problemId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const words = retake.split(/\s+/).filter(Boolean).length;
      props.onResult({
        ...data,
        retake,
        wpm: spoken && seconds > 2 ? Math.round(words / (seconds / 60)) : 0,
        fillers: fillerBreakdown(retake).reduce((n, f) => n + f.count, 0),
      });
    } catch (e: any) {
      setError(String(e?.message || e));
    }
    setStatus("idle");
  };

  const start = () => {
    stopHearing(); // or the mic would record it
    saidRef.current = "";
    setSaid("");
    setLeft(MAX_SECONDS);
    startedRef.current = Date.now();
    stt.start();
    setStatus("recording");
  };

  const stop = () => {
    if (status !== "recording") return;
    const seconds = (Date.now() - startedRef.current) / 1000;
    stt.stop();
    setStatus("grading");
    // give the recognizer a moment to deliver its last final result
    setTimeout(() => grade(saidRef.current, seconds, true), 900);
  };

  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [status]);
  useEffect(() => {
    if (left <= 0) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const last = attempts[attempts.length - 1];
  const quoted = target.code_quote.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="card redo" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Redo this moment <span className="muted">· {clock(target.t)}</span></h2>
          <span className="spacer" />
          <button onClick={props.onClose}>Close</button>
        </header>

        <pre className="code">
          {target.code.split("\n").map((line, i) => (
            <div key={i} className={quoted.includes(line.trim()) ? "hl" : ""}>
              <span className="ln">{i + 1}</span>{line || " "}
            </div>
          ))}
        </pre>

        <div className="evidence">
          <span className="tag">What you said the first time</span>
          {target.firstSaid ? <q>{target.firstSaid}</q> : <i>Nothing. You wrote this in silence.</i>}
        </div>

        <p className="ask"><b>Explain out loud:</b> {target.description}. Say <i>why</i>, as if the interviewer can't see your screen.</p>

        <div className="redo-rec">
          {status === "idle" && (
            <button className="primary" onClick={start}>● {attempts.length ? "Try again" : "Record"} ({MAX_SECONDS}s)</button>
          )}
          {status === "recording" && (
            <button className="danger" onClick={stop}>■ Stop <span className="timer">{left}s</span></button>
          )}
          {status === "grading" && <span className="muted">Grading your retake…</span>}
          {status === "recording" && <span className="rec-dot" />}
        </div>
        {status === "recording" && (
          <p className="live">{said} <span className="muted">{stt.interim}</span>{!said && !stt.interim && <span className="muted">Listening…</span>}</p>
        )}
        {status === "idle" && (
          <form
            className="typed"
            onSubmit={(e) => {
              e.preventDefault();
              const text = new FormData(e.currentTarget).get("text")?.toString().trim();
              if (text) grade(text, 0, false);
              e.currentTarget.reset();
            }}
          >
            <input name="text" placeholder="Mic not working? Type your explanation and press Enter" />
          </form>
        )}
        {error && <p className="fail">Couldn't grade that: {error}</p>}

        {last && status !== "recording" && (
          <div className={`redo-result ${last.explained ? "good" : "miss"}`}>
            <div className="score-head">
              <span>{last.explained ? "✓ That explains it" : "✗ Not there yet"} <span className="muted">· attempt {attempts.length}</span></span>
              <span className="pips">
                {[1, 2, 3, 4].map((n) => <i key={n} className={n <= last.score ? "on" : ""} />)}
                <b>{last.score}/4</b>
              </span>
            </div>
            <div className="evidence"><span className="tag">Your retake</span><q>{last.retake || "(nothing heard)"}</q></div>
            <p>{last.verdict}</p>
            <p><b>Compared with the first time:</b> {last.improved}</p>
            {last.still_missing && <p><b>Still missing:</b> {last.still_missing}</p>}
            <p className="muted small">
              {last.wpm > 0 && `${last.wpm} words per minute · `}{last.fillers} filler word{last.fillers === 1 ? "" : "s"}
            </p>
            <details>
              <summary>One strong way to say it</summary>
              <p>{last.model_answer}</p>
              {hear === "idle" && <button className="small" onClick={() => hearIt(last.model_answer)}>▶ Hear it</button>}
              {hear === "loading" && <button className="small" onClick={stopHearing}>Loading… ■</button>}
              {hear === "playing" && <button className="small" onClick={stopHearing}>■ Stop</button>}
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
