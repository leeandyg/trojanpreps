"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { problem } from "@/lib/problem";
import { clock } from "@/lib/format";
import { computeMetrics } from "@/lib/metrics";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useTTS } from "@/hooks/useTTS";
import { usePyodide } from "@/hooks/usePyodide";
import ReportView from "@/components/Report";
import type {
  AvatarState, Decision, Grounding, InterviewerReply, Metrics, Mode, Report, RunResult, TimelineEvent, Trigger,
} from "@/lib/types";

const SPEECH_SETTLE_MS = 1500; // quiet after an utterance before consulting the interviewer
const CODE_SETTLE_MS = 4000; // no typing for this long before a code-triggered check
const PROBE_COOLDOWN_MS = 25000; // minimum gap between unprompted probes

const STATE_LABEL: Record<AvatarState, string> = {
  listening: "Listening",
  waiting: "Waiting — take your time",
  thinking: "Thinking",
  speaking: "Speaking",
};

const meaningfulLines = (code: string) =>
  code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l !== "pass");

export default function Page() {
  const [phase, setPhase] = useState<"lobby" | "live" | "report">("lobby");
  const [mode, setMode] = useState<Mode>("coach");
  const [code, setCode] = useState(problem.starterCode);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [grounding, setGrounding] = useState<Grounding | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [candidateTalking, setCandidateTalking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [typed, setTyped] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [reportError, setReportError] = useState("");

  // Refs mirror state so timers and async callbacks always see current values.
  const startRef = useRef(0);
  const modeRef = useRef(mode);
  const codeRef = useRef(code);
  const timelineRef = useRef<TimelineEvent[]>([]);
  const decisionsRef = useRef<Decision[]>([]);
  const runRef = useRef<RunResult | null>(null);
  const hintRef = useRef(0);
  const editTimesRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const pendingRef = useRef<Trigger | null>(null);
  const mutedRef = useRef(false);
  const talkingRef = useRef(false);
  const lastProbeRef = useRef(-PROBE_COOLDOWN_MS);
  const lastCheckedCodeRef = useRef(problem.starterCode);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  modeRef.current = mode;
  const now = () => Date.now() - startRef.current;
  const speak = useTTS();
  const py = usePyodide();

  const addEvent = useCallback((e: TimelineEvent) => {
    timelineRef.current = [...timelineRef.current, e];
    setTimeline(timelineRef.current);
  }, []);

  const say = useCallback(
    async (text: string, kind: string, g?: Grounding) => {
      addEvent({ type: "interviewer", t: now(), text, kind, grounding: g });
      mutedRef.current = true;
      setSpeaking(true);
      await speak(text);
      setSpeaking(false);
      setTimeout(() => (mutedRef.current = false), 400); // let the echo die out
    },
    [addEvent, speak]
  );

  // Ask the interviewer model whether to say anything, given everything so far.
  const consult = useCallback(
    async (trigger: Trigger) => {
      if (busyRef.current) {
        if (pendingRef.current !== "wrapup") pendingRef.current = trigger;
        return;
      }
      busyRef.current = true;
      setThinking(true);
      const sentAt = timelineRef.current.length;
      const probeAllowed =
        trigger === "wrapup" || (modeRef.current === "coach" && now() - lastProbeRef.current > PROBE_COOLDOWN_MS);
      lastCheckedCodeRef.current = codeRef.current;
      try {
        const res = await fetch("/api/interviewer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: modeRef.current,
            trigger,
            code: codeRef.current,
            timeline: timelineRef.current,
            run: runRef.current,
            decisions: decisionsRef.current,
            hintLevel: hintRef.current,
            probeAllowed,
          }),
        });
        const reply: InterviewerReply & { error?: string } = await res.json();
        setThinking(false);
        if (reply.error) throw new Error(reply.error);

        decisionsRef.current = reply.decisions;
        setDecisions(reply.decisions);

        const isProbe = reply.kind === "probe";
        // The candidate started talking again while we were deciding: an
        // unprompted probe is now an interruption, so drop it.
        const stale = isProbe && (talkingRef.current || timelineRef.current.length !== sentAt);
        if (reply.action === "speak" && !(isProbe && !probeAllowed) && !stale) {
          hintRef.current = Math.max(hintRef.current, reply.hint_level);
          const g = reply.grounding?.code_quote || reply.grounding?.said_quote ? reply.grounding : undefined;
          if (isProbe || reply.kind === "wrapup") {
            lastProbeRef.current = now();
            setGrounding(g || null);
          }
          await say(reply.say, reply.kind, g);
        }
      } catch (e) {
        console.error(e);
        setThinking(false);
      } finally {
        busyRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) consult(next);
      }
    },
    [say]
  );

  // --- candidate speech ---
  const onUtterance = useCallback(
    (text: string, start: number, end: number, isTyped = false) => {
      addEvent({ type: "speech", t: start, start, end, text, typed: isTyped || undefined });
      if (speechTimer.current) clearTimeout(speechTimer.current);
      speechTimer.current = setTimeout(() => consult("speech"), isTyped ? 0 : SPEECH_SETTLE_MS);
    },
    [addEvent, consult]
  );

  const stt = useSpeechRecognition(
    {
      onFinal: (text, s, e) => onUtterance(text, s - startRef.current, e - startRef.current),
      onActivity: () => {
        // Still talking: hold off consulting until they finish the thought.
        if (speechTimer.current) {
          clearTimeout(speechTimer.current);
          speechTimer.current = setTimeout(() => consult("speech"), SPEECH_SETTLE_MS);
        }
        talkingRef.current = true;
        setCandidateTalking(true);
        if (talkTimer.current) clearTimeout(talkTimer.current);
        talkTimer.current = setTimeout(() => {
          talkingRef.current = false;
          setCandidateTalking(false);
        }, 1200);
      },
    },
    mutedRef
  );

  // --- code edits ---
  const onCodeChange = (value?: string) => {
    const next = value ?? "";
    codeRef.current = next;
    setCode(next);
    if (phase !== "live") return;
    editTimesRef.current.push(now());
    if (codeTimer.current) clearTimeout(codeTimer.current);
    codeTimer.current = setTimeout(function check() {
      if (modeRef.current !== "coach") return;
      // Mid-sentence: check again once they stop, the code may be explained by then.
      if (talkingRef.current) return void (codeTimer.current = setTimeout(check, 2000));
      const before = new Set(meaningfulLines(lastCheckedCodeRef.current));
      const added = meaningfulLines(codeRef.current).filter((l) => !before.has(l));
      if (added.length < 2) return;
      const wait = PROBE_COOLDOWN_MS - (now() - lastProbeRef.current);
      if (wait > 0) return void (codeTimer.current = setTimeout(check, wait));
      consult("code");
    }, CODE_SETTLE_MS);
  };

  const runCode = async () => {
    const result = await py.run(codeRef.current);
    runRef.current = result;
    setRunResult(result);
    const summary = result.error
      ? `error: ${result.error.trim().split("\n").pop()}`
      : `${result.passed}/${result.total} tests passed`;
    addEvent({ type: "run", t: now(), passed: result.passed, total: result.total, summary });
    if (phase === "live" && modeRef.current === "coach") consult("run");
  };

  // --- session lifecycle ---
  const startSession = async () => {
    startRef.current = Date.now();
    setPhase("live");
    navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => videoRef.current && (videoRef.current.srcObject = stream))
      .catch(() => {});
    stt.start();
    busyRef.current = true;
    await say(problem.intro, "intro");
    busyRef.current = false;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) consult(next);
  };

  const endSession = async () => {
    stt.stop();
    speechSynthesis.cancel();
    [speechTimer, codeTimer, talkTimer].forEach((t) => t.current && clearTimeout(t.current));
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    const m = computeMetrics(timelineRef.current, editTimesRef.current, now());
    setMetrics(m);
    setPhase("report");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: modeRef.current,
          code: codeRef.current,
          timeline: timelineRef.current,
          run: runRef.current,
          decisions: decisionsRef.current,
          metrics: m,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data);
    } catch (e: any) {
      setReportError(String(e?.message || e));
    }
  };

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setElapsed(now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [timeline, stt.interim]);

  if (phase === "report") {
    return (
      <ReportView
        report={report}
        metrics={metrics!}
        decisions={decisions}
        code={code}
        run={runResult}
        error={reportError}
        mode={mode}
      />
    );
  }

  const avatar: AvatarState = speaking ? "speaking" : thinking ? "thinking" : candidateTalking ? "listening" : "waiting";

  return (
    <div className="room">
      <header className="topbar">
        <strong>Mock Interview</strong>
        <div className="modes">
          {(["interview", "coach"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "interview" ? "Interview" : "Coach"}
            </button>
          ))}
        </div>
        <span className="muted">
          {mode === "interview"
            ? "Realistic: clarifying questions only, follow-up at wrap-up"
            : "Guided: probes unexplained decisions, hints on request"}
        </span>
        <span className="spacer" />
        {phase === "live" && (
          <>
            <span className="timer">{clock(elapsed)}</span>
            <button onClick={() => consult("wrapup")}>I'm done — wrap up</button>
            <button className="danger" onClick={endSession}>End &amp; get report</button>
          </>
        )}
      </header>

      <main className="cols">
        <section className="panel problem">
          <h2>{problem.title}</h2>
          <p>{problem.statement}</p>
          {problem.examples.map((ex, i) => (
            <div key={i} className="example">
              <div><b>Input:</b> {ex.input}</div>
              <div><b>Output:</b> {ex.output}</div>
              {ex.note && <div className="muted">{ex.note}</div>}
            </div>
          ))}
          <p className="muted">
            Ask the interviewer about anything that isn't specified. Talk through your reasoning as you write.
          </p>
        </section>

        <section className="panel editor">
          <div className="editor-wrap">
            <Editor
              language="python"
              theme="vs-dark"
              value={code}
              onChange={onCodeChange}
              options={{ fontSize: 15, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }}
            />
          </div>
          <div className="runbar">
            <button onClick={runCode} disabled={!py.ready}>{py.ready ? "▶ Run tests" : "Loading Python…"}</button>
            {runResult && !runResult.error && <span>{runResult.passed}/{runResult.total} passed</span>}
          </div>
          <div className="output">
            {!runResult && <span className="muted">Test results appear here.</span>}
            {runResult?.error && <pre className="fail">{runResult.error}</pre>}
            {runResult?.results.map((r, i) => (
              <div key={i} className={r.ok ? "pass" : "fail"}>
                {r.ok ? "✓" : "✗"} {r.input} → {r.got} {!r.ok && <span className="muted">(expected {r.expected})</span>}
              </div>
            ))}
            {runResult?.stdout && <pre>{runResult.stdout}</pre>}
          </div>
        </section>

        <section className="panel side">
          <div className={`avatar ${avatar}`}>
            <div className="orb" />
            <div>
              <div className="who">Interviewer</div>
              <div className="state">{STATE_LABEL[avatar]}</div>
            </div>
          </div>
          {grounding && (
            <div className="why">
              <div className="why-title">Why I asked</div>
              {grounding.code_quote && <div>Your code: <code>{grounding.code_quote}</code></div>}
              <div>
                You said: {grounding.said_quote ? <q>{grounding.said_quote}</q> : <i>nothing about this yet</i>}
              </div>
            </div>
          )}

          <div className="camera">
            <video ref={videoRef} autoPlay muted playsInline />
            <span>You</span>
          </div>

          <div className="log" ref={logRef}>
            {timeline.map((e, i) =>
              e.type === "run" ? (
                <div key={i} className="line sys">Ran code: {e.summary}</div>
              ) : (
                <div key={i} className={`line ${e.type}`}>
                  <b>{e.type === "speech" ? "You" : "Interviewer"}</b> {e.text}
                </div>
              )
            )}
            {stt.interim && <div className="line speech interim"><b>You</b> {stt.interim}</div>}
          </div>
          <form
            className="typed"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!typed.trim() || phase !== "live") return;
              onUtterance(typed.trim(), now(), now(), true);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={stt.supported ? "Mic not picking you up? Type what you'd say" : "No speech recognition in this browser (use Chrome). Type here"}
            />
          </form>
        </section>
      </main>

      {phase === "lobby" && (
        <div className="overlay">
          <div className="card">
            <h1>Mock technical interview</h1>
            <p>
              You'll solve <b>{problem.title}</b> in Python while talking to an AI interviewer that hears you and sees
              your editor. Afterwards you get a report on how well you explained your thinking.
            </p>
            <div className="modes big">
              <button className={mode === "interview" ? "on" : ""} onClick={() => setMode("interview")}>
                <b>Interview</b>
                <small>Like the real thing. Answers clarifying questions, no hints, one follow-up at the end.</small>
              </button>
              <button className={mode === "coach" ? "on" : ""} onClick={() => setMode("coach")}>
                <b>Coach</b>
                <small>Asks about decisions you didn't explain. Gives small hints when you ask.</small>
              </button>
            </div>
            <button className="primary" onClick={startSession}>Start interview</button>
            <p className="muted">Uses your microphone and camera. Works in Chrome. Headphones recommended.</p>
          </div>
        </div>
      )}
    </div>
  );
}
