"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { problem } from "@/lib/problem";
import { clock } from "@/lib/format";
import { computeMetrics } from "@/lib/metrics";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useTTS } from "@/hooks/useTTS";
import { usePyodide } from "@/hooks/usePyodide";
import { watchVoice } from "@/hooks/voiceActivity";
import ReportView from "@/components/Report";
import { demoSession } from "@/lib/demoSession";
import type {
  AvatarState, CodeSnapshot, Decision, Grounding, InterviewerReply, Metrics, Mode, Report, RunResult, TimelineEvent, Trigger,
} from "@/lib/types";

const SPEECH_SETTLE_MS = 1500; // quiet after an utterance before consulting the interviewer
const QUESTION_SETTLE_MS = 600; // shorter wait when the utterance sounds like a direct question
// Barge-in: the candidate talking over the interviewer cuts the interviewer off.
const BARGE_RMS = 0.045; // mic loudness that counts as speech
const BARGE_HOLD_MS = 250; // how long it must stay that loud
const BARGE_GRACE_MS = 500; // ignore the mic right after the interviewer's audio starts (echo canceller settling)
const BARGE_CONFIRM_MS = 1800; // if no words are heard this long after a barge-in, it was noise: say the line again
const CONSULT_TIMEOUT_MS = 15000; // give up on an interviewer model call after this long
const SORRY_LINE = "Sorry, I lost you for a second. Could you say that again?";
// Backchannels: short acknowledgements played without a model call.
const BACKCHANNELS = ["Mm-hm.", "Okay.", "Right.", "Got it."];
const BACKCHANNEL_DELAY_MS = 700; // pause after a thought before acknowledging it
const BACKCHANNEL_GAP_MS = 14000; // at most one this often
const BACKCHANNEL_MIN_WORDS = 8;
const BACKCHANNEL_VOLUME = 0.6;
const CODE_SETTLE_MS = 4000; // no typing for this long before a code-triggered check
const PROBE_COOLDOWN_MS = 25000; // minimum gap between unprompted probes
const MAX_FOLLOWUPS = 2; // follow-up questions on one answer before the interviewer moves on
// The recognizer cuts speech into pieces at small pauses. Pieces closer than this are shown as one block.
const MERGE_GAP_MS = 2500;
const QUESTION_KINDS = ["probe", "followup", "wrapup"]; // interviewer lines that expect an answer

const STATE_LABEL: Record<AvatarState, string> = {
  listening: "Listening",
  waiting: "Waiting — take your time",
  thinking: "Thinking",
  speaking: "Speaking",
};

// Rough check for speech aimed at the interviewer, to answer sooner and to not "mm-hm" a question.
const looksLikeQuestion = (text: string) =>
  /\?|\b(can|could|should|would|may) (i|you|we|there|it)\b|\b(is|are|does|do|will) (it|there|the|this|that|we|i)\b|^(what|how|why|when|which|is|are|do|does)\b|\bhint\b/i.test(text.trim());

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  // Refs mirror state so timers and async callbacks always see current values.
  const startRef = useRef(0);
  const modeRef = useRef(mode);
  const codeRef = useRef(code);
  const timelineRef = useRef<TimelineEvent[]>([]);
  const decisionsRef = useRef<Decision[]>([]);
  const runRef = useRef<RunResult | null>(null);
  const hintRef = useRef(0);
  const codeHistoryRef = useRef<CodeSnapshot[]>([{ t: 0, code: problem.starterCode }]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioOffsetRef = useRef(0); // session time at which the mic recording began
  const busyRef = useRef(false);
  const pendingRef = useRef<Trigger | null>(null);
  const mutedRef = useRef(false);
  const talkingRef = useRef(false);
  const lastProbeRef = useRef(-PROBE_COOLDOWN_MS);
  const lastCheckedCodeRef = useRef(problem.starterCode);
  const speakingRef = useRef(false);
  const speakStartRef = useRef(0);
  const currentLineRef = useRef<TimelineEvent | null>(null);
  const stopVoiceWatchRef = useRef<(() => void) | null>(null);
  const backchannelsRef = useRef<string[]>([]);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBackRef = useRef(0);
  const settleRef = useRef(SPEECH_SETTLE_MS);
  const endedRef = useRef(false); // session over: nothing may speak or consult any more
  const newSpeechRef = useRef(false); // the candidate has said something the model has not seen yet
  const unmuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resaidRef = useRef(new WeakSet<object>()); // lines already repeated once after a false barge-in
  const lastActivityRef = useRef(0); // when the mic last heard the candidate
  const speechSeqRef = useRef(0); // counts candidate utterances, to notice speech that arrived mid-request
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  modeRef.current = mode;
  const now = () => Date.now() - startRef.current;
  const tts = useTTS();
  const py = usePyodide();

  const addEvent = useCallback((e: TimelineEvent) => {
    timelineRef.current = [...timelineRef.current, e];
    setTimeline(timelineRef.current);
  }, []);

  // Speaks a line that is already in the timeline.
  const voice = useCallback(
    async (ev: TimelineEvent & { type: "interviewer" }) => {
      if (endedRef.current) return;
      currentLineRef.current = ev;
      if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
      speakingRef.current = true;
      speakStartRef.current = Infinity; // no barge-in until sound is actually playing
      setSpeaking(true);
      // The mic is only muted once audio starts, so words said while it loads are not lost.
      const url = await tts.speak(ev.text, () => {
        mutedRef.current = true;
        speakStartRef.current = Date.now();
      });
      if (url) ev.audioUrl = url;
      speakingRef.current = false;
      setSpeaking(false);
      // After a barge-in the mic is already live again; otherwise let the echo die out first.
      if (!ev.interrupted) unmuteTimer.current = setTimeout(() => (mutedRef.current = false), 400);
    },
    [tts]
  );

  const say = useCallback(
    async (text: string, kind: string, g?: Grounding) => {
      if (endedRef.current) return;
      const ev = { type: "interviewer" as const, t: now(), text, kind, grounding: g };
      addEvent(ev);
      await voice(ev);
    },
    [addEvent, voice]
  );

  // Ask the interviewer model whether to say anything, given everything so far.
  const consult = useCallback(
    async (trigger: Trigger) => {
      if (endedRef.current) return;
      if (busyRef.current) {
        if (pendingRef.current !== "wrapup") pendingRef.current = trigger;
        return;
      }
      // A speech consult with nothing new to hear would just make the interviewer repeat itself.
      if (trigger === "speech" && !newSpeechRef.current) return;
      newSpeechRef.current = false;
      busyRef.current = true;
      setThinking(true);
      const sentSeq = speechSeqRef.current;
      const sentTime = Date.now();
      const probeAllowed =
        trigger === "wrapup" || (modeRef.current === "coach" && now() - lastProbeRef.current > PROBE_COOLDOWN_MS);
      // Is the candidate's latest speech an answer to a question the interviewer just asked?
      const tl = timelineRef.current;
      const lastLine = tl.findLast((e) => e.type === "interviewer");
      const answering =
        trigger === "speech" &&
        tl[tl.length - 1]?.type !== "interviewer" &&
        lastLine?.type === "interviewer" &&
        QUESTION_KINDS.includes(lastLine.kind) &&
        tl.slice(tl.indexOf(lastLine)).some((e) => e.type === "speech");
      // Follow-ups already spent on this question.
      let followups = 0;
      for (let i = tl.length - 1; i >= 0; i--) {
        const e = tl[i];
        if (e.type !== "interviewer") continue;
        if (e.kind !== "followup") break;
        followups++;
      }
      const followupsLeft = Math.max(0, MAX_FOLLOWUPS - followups);
      const sentCode = codeRef.current;
      const body = JSON.stringify({
        mode: modeRef.current,
        trigger,
        code: sentCode,
        timeline: tl,
        run: runRef.current,
        decisions: decisionsRef.current,
        hintLevel: hintRef.current,
        probeAllowed,
        answering,
        followupsLeft,
      });
      const ask = async (): Promise<InterviewerReply> => {
        const res = await fetch("/api/interviewer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(CONSULT_TIMEOUT_MS),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data;
      };
      try {
        // The candidate is waiting on speech and wrap-up consults, so those get one retry.
        const reply = await ask().catch((e) => {
          if (trigger === "code" || trigger === "run") throw e;
          return ask();
        });
        setThinking(false);
        if (endedRef.current) return;

        decisionsRef.current = reply.decisions;
        setDecisions(reply.decisions);

        // A question asked in reply to an answer is a follow-up, whatever the model called it.
        let kind = reply.kind;
        if (answering && kind === "probe") kind = "followup";
        if (!answering && (kind === "followup" || kind === "ack")) kind = "other";
        const allowed =
          kind === "probe" ? probeAllowed : kind === "followup" ? followupsLeft > 0 : true;
        // The candidate kept talking while we were deciding. Speaking now would cut across
        // them, and the reply is based on half of what they said. Their new speech has
        // already queued another consult, so drop this one.
        const stale = trigger !== "wrapup" && (lastActivityRef.current > sentTime || speechSeqRef.current !== sentSeq);
        if (reply.action === "speak" && allowed && !stale) {
          hintRef.current = Math.max(hintRef.current, reply.hint_level);
          const g = reply.grounding?.code_quote || reply.grounding?.said_quote ? reply.grounding : undefined;
          if (kind === "probe" || kind === "followup" || kind === "wrapup") {
            lastProbeRef.current = now();
            setGrounding(g || null);
          }
          await say(reply.say, kind, g);
        }
        // Only count this code as looked at when the look could have led to a probe;
        // otherwise a passing "okay" would use up the candidate's new lines unseen.
        if (!stale && (trigger === "code" || kind === "probe")) lastCheckedCodeRef.current = sentCode;
      } catch (e) {
        console.error(e);
        setThinking(false);
        // Don't leave an answer hanging in silence when the model call failed twice.
        if (answering && lastLine?.type === "interviewer") await say(SORRY_LINE, lastLine.kind);
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
  // Consult once the candidate has been quiet for `ms`. The timer clears itself when it
  // fires, so later mic activity cannot re-arm a consult that has nothing new to send.
  const armSpeechTimer = (ms: number) => {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = setTimeout(() => {
      speechTimer.current = null;
      consult("speech");
    }, ms);
  };

  const onUtterance = useCallback(
    (text: string, start: number, end: number, isTyped = false) => {
      if (endedRef.current) return;
      newSpeechRef.current = true;
      speechSeqRef.current++;
      // Join this piece onto the previous one if the candidate barely paused, so one
      // thought is one block in the transcript (and one line for the model).
      const tl = timelineRef.current;
      const prev = tl[tl.length - 1];
      if (!isTyped && prev?.type === "speech" && !prev.typed && start - prev.end < MERGE_GAP_MS) {
        text = `${prev.text} ${text}`;
        timelineRef.current = [...tl.slice(0, -1), { ...prev, end, text }];
        setTimeline(timelineRef.current);
      } else {
        addEvent({ type: "speech", t: start, start, end, text, typed: isTyped || undefined });
      }
      const question = looksLikeQuestion(text);
      settleRef.current = isTyped ? 0 : question ? QUESTION_SETTLE_MS : SPEECH_SETTLE_MS;
      armSpeechTimer(settleRef.current);

      // Acknowledge a finished thought with a quick "mm-hm", the way a person on a call would.
      if (backTimer.current) clearTimeout(backTimer.current);
      const clips = backchannelsRef.current;
      const longEnough = text.split(/\s+/).length >= BACKCHANNEL_MIN_WORDS;
      if (!isTyped && !question && longEnough && clips.length && Date.now() - lastBackRef.current > BACKCHANNEL_GAP_MS) {
        backTimer.current = setTimeout(() => {
          if (busyRef.current || speakingRef.current) return;
          lastBackRef.current = Date.now();
          const clip = new Audio(clips[Math.floor(Math.random() * clips.length)]);
          clip.volume = BACKCHANNEL_VOLUME;
          clip.play().catch(() => {});
        }, BACKCHANNEL_DELAY_MS);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addEvent, consult]
  );

  const stt = useSpeechRecognition(
    {
      onFinal: (text, s, e) => {
        // On speakers the mic can pick up our own "mm-hm"; that is not the candidate.
        const echo = Date.now() - lastBackRef.current < 2500 && /^(m+-?h+m+|okay|ok|right|got it)[.!]?$/i.test(text.trim());
        if (!echo) onUtterance(text, s - startRef.current, e - startRef.current);
      },
      onActivity: () => {
        // Still talking: hold off consulting until they finish the thought.
        if (speechTimer.current) armSpeechTimer(SPEECH_SETTLE_MS);
        if (backTimer.current) clearTimeout(backTimer.current);
        lastActivityRef.current = Date.now();
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

  // The candidate started talking over the interviewer: stop and listen.
  const bargeIn = () => {
    const ev = currentLineRef.current;
    if (!speakingRef.current || ev?.type !== "interviewer") return;
    ev.interrupted = true;
    stt.keepHeard(); // what the mic heard during the mute is the candidate, keep it
    mutedRef.current = false;
    tts.stop();
    // A cough or a keyboard clatter can trip this. If no words follow, it was not a real
    // interruption, so say the line again (once) instead of leaving dead air.
    const at = Date.now();
    setTimeout(() => {
      const heardWords = lastActivityRef.current > at;
      if (endedRef.current || heardWords || busyRef.current || speakingRef.current || resaidRef.current.has(ev)) return;
      resaidRef.current.add(ev);
      ev.interrupted = false;
      busyRef.current = true;
      voice(ev).finally(() => {
        busyRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) consult(next);
      });
    }, BARGE_CONFIRM_MS);
  };
  const bargeInRef = useRef(bargeIn);
  bargeInRef.current = bargeIn;

  // --- code edits ---
  const onCodeChange = (value?: string) => {
    const next = value ?? "";
    codeRef.current = next;
    setCode(next);
    if (phase !== "live") return;
    codeHistoryRef.current.push({ t: now(), code: next });
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
    endedRef.current = false;
    startRef.current = Date.now();
    setPhase("live");
    navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => videoRef.current && (videoRef.current.srcObject = stream))
      .catch(() => {});
    // Record the mic for the whole session so the replay has audio.
    navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        // Watch the mic for the candidate talking over the interviewer.
        let loudMs = 0;
        stopVoiceWatchRef.current = watchVoice(stream, (rms) => {
          const listening = speakingRef.current && Date.now() - speakStartRef.current > BARGE_GRACE_MS;
          loudMs = listening && rms > BARGE_RMS ? loudMs + 50 : 0;
          if (loudMs >= BARGE_HOLD_MS) {
            loudMs = 0;
            bargeInRef.current();
          }
        });
        const rec = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          setAudioUrl(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
        };
        audioOffsetRef.current = now();
        rec.start(1000);
        recorderRef.current = rec;
      })
      .catch(() => {});
    stt.start();
    busyRef.current = true;
    await say(problem.intro, "intro");
    busyRef.current = false;
    if (endedRef.current) return;
    // Fetch the backchannel clips one at a time, after the intro, to stay under the voice provider's concurrency limit.
    (async () => {
      for (const phrase of BACKCHANNELS) {
        const url = await tts.preload(phrase);
        if (url) backchannelsRef.current.push(url);
      }
    })();
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) consult(next);
  };

  const endSession = async () => {
    endedRef.current = true;
    pendingRef.current = null;
    stt.stop();
    tts.stop();
    stopVoiceWatchRef.current?.();
    [speechTimer, codeTimer, talkTimer, backTimer, unmuteTimer].forEach((t) => t.current && clearTimeout(t.current));
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    showReport(now());
  };

  // Computes metrics from the refs, switches to the report page, and asks for the written feedback.
  const showReport = async (sessionMs: number) => {
    const editTimes = codeHistoryRef.current.slice(1).map((s) => s.t);
    const m = computeMetrics(timelineRef.current, editTimes, sessionMs);
    setMetrics(m);
    setDurationMs(sessionMs);
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

  // /?demo loads a canned session straight into the report, to work on the replay without a mic.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("demo")) return;
    timelineRef.current = demoSession.timeline;
    codeHistoryRef.current = demoSession.codeHistory;
    decisionsRef.current = demoSession.decisions;
    runRef.current = demoSession.run;
    codeRef.current = demoSession.codeHistory[demoSession.codeHistory.length - 1].code;
    setTimeline(demoSession.timeline);
    setDecisions(demoSession.decisions);
    setRunResult(demoSession.run);
    setCode(codeRef.current);
    showReport(demoSession.durationMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        timeline={timeline}
        codeHistory={codeHistoryRef.current}
        durationMs={durationMs}
        audioUrl={audioUrl}
        audioOffsetMs={audioOffsetRef.current}
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
              placeholder={stt.blocked ? "Microphone is blocked. Allow it in the address bar, or type here" : stt.supported ? "Mic not picking you up? Type what you'd say" : "No speech recognition in this browser (use Chrome). Type here"}
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
