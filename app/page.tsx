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
  AvatarState, CodeSnapshot, Decision, Grounding, InterviewerReply, Metrics, Mode, Report, RunResult, SpokenWord, TimelineEvent, Trigger,
} from "@/lib/types";

const SPEECH_SETTLE_MS = 1500; // quiet after an utterance before consulting the interviewer
const QUESTION_SETTLE_MS = 600; // shorter wait when the utterance sounds like a direct question
const TURN_SETTLE_MS = 300; // wait when the recognizer itself says the turn is over (Deepgram); it has already judged the pause
// Barge-in: the candidate talking over the interviewer cuts the interviewer off.
const BARGE_RMS = 0.045; // mic loudness that counts as speech
const BARGE_HOLD_MS = 250; // how long it must stay that loud
const BARGE_GRACE_MS = 500; // ignore the mic right after the interviewer's audio starts (echo canceller settling)
const BARGE_CONFIRM_MS = 1800; // if no words are heard this long after a barge-in, it was noise: say the line again
const CONSULT_TIMEOUT_MS = 15000; // give up on an interviewer model call after this long
const SORRY_LINE = "Sorry, I lost you for a second. Could you say that again?";
// Backchannels: short acknowledgements with no model call of their own. One plays when the
// interviewer model decides a finished thought needs no reply.
// Neutral on purpose: nothing that sounds like agreement ("right") when the reasoning may be wrong.
const BACKCHANNELS = ["Okay.", "I see."];
const BACKCHANNEL_GAP_MS = 35000; // at most one this often
const BACKCHANNEL_MIN_WORDS = 15;
const BACKCHANNEL_VOLUME = 0.6; // also used for the thinking sounds
// Thinking sounds: fill the silence when the candidate is waiting on a reply and the model is slow.
const THINKING_CLIPS = ["Hmm.", "Let's see."];
const THINKING_AFTER_MS = 1200; // only if the model has not replied by then
const THINKING_GAP_MS = 30000; // at most one this often
// Session clock.
const SESSION_MINUTES = [5, 10, 20]; // lengths offered in the lobby
const DEFAULT_MINUTES = 10;
const TIME_CHECKS_MIN = [5, 2]; // minutes remaining at which the interviewer mentions the time (skipped if over 70% of the session)
const timeLine = (m: number) => (m > 0 ? `Just a heads up, we have about ${m} minute${m === 1 ? "" : "s"} left.` : "That's time, so let's stop there."); // used when the model call fails
// Check-ins (Coach): with no interviewer contact for this long, ask the model whether the candidate is stuck.
const CHECKIN_MS = 60000;
const CHECKIN_TICK_MS = 5000;
// Cutting in (time checks and check-ins): wait for a breath, then speak with a longer barge-in grace.
const INTERRUPT_WAIT_MS = 5000; // how long to wait for the candidate to stop talking before speaking anyway
const INTERRUPT_GRACE_MS = 2000; // the candidate's trailing words do not cut the interviewer off during this
const CODE_SETTLE_MS = 4000; // no typing for this long before a code-triggered check
const PROBE_COOLDOWN_MS = 25000; // minimum gap between unprompted probes
const MAX_FOLLOWUPS = 2; // follow-up questions on one answer before the interviewer moves on
// The recognizer cuts speech into pieces at small pauses. Pieces closer than this are shown as one block.
const MERGE_GAP_MS = 2500;
const QUESTION_KINDS = ["probe", "followup", "wrapup", "closing"]; // interviewer lines that expect an answer

const STATE_LABEL: Record<AvatarState, string> = {
  listening: "Listening",
  waiting: "Waiting — take your time",
  thinking: "Thinking",
  speaking: "Speaking",
};

// Rough check for speech aimed at the interviewer, to answer sooner and to not backchannel a question.
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
  const [limitMin, setLimitMin] = useState(DEFAULT_MINUTES);
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
  const graceRef = useRef(BARGE_GRACE_MS); // barge-in grace for the line being spoken
  const backchannelsRef = useRef<string[]>([]);
  const thinkingRef = useRef<string[]>([]);
  const lastBackRef = useRef(0);
  const lastThinkRef = useRef(0);
  const lastClipRef = useRef(0); // when any short clip (backchannel or thinking sound) last played
  const lastUtteranceRef = useRef({ text: "", typed: false }); // the candidate's latest speech block
  const wordsRef = useRef<SpokenWord[][]>([]); // word timings per turn, in session ms, for the metrics
  const turnsRef = useRef(false); // the recognizer detects end of turn itself
  const limitRef = useRef(DEFAULT_MINUTES * 60000);
  const wrapAskedRef = useRef(false);
  const lastContactRef = useRef(0); // when the interviewer was last consulted or last spoke
  const timeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const checkinTimer = useRef<ReturnType<typeof setInterval> | null>(null);
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
    async (ev: TimelineEvent & { type: "interviewer" }, grace = BARGE_GRACE_MS) => {
      if (endedRef.current) return;
      currentLineRef.current = ev;
      graceRef.current = grace;
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
      lastContactRef.current = Date.now();
      // After a barge-in the mic is already live again; otherwise let the echo die out first.
      if (!ev.interrupted) unmuteTimer.current = setTimeout(() => (mutedRef.current = false), 400);
    },
    [tts]
  );

  const say = useCallback(
    async (text: string, kind: string, g?: Grounding, grace?: number) => {
      if (endedRef.current) return;
      const ev = { type: "interviewer" as const, t: now(), text, kind, grounding: g };
      addEvent(ev);
      await voice(ev, grace);
    },
    [addEvent, voice]
  );

  // Plays a short pre-fetched clip (backchannel or thinking sound). Resolves when it has finished.
  const playClip = (clips: string[]) => {
    lastClipRef.current = Date.now();
    const clip = new Audio(clips[Math.floor(Math.random() * clips.length)]);
    clip.volume = BACKCHANNEL_VOLUME;
    return new Promise<void>((done) => {
      clip.onended = clip.onerror = () => done();
      clip.play().catch(() => done());
      setTimeout(done, 3000);
    });
  };

  // Before cutting in, give the candidate a moment to finish the sentence they are in.
  const waitForGap = async () => {
    const until = Date.now() + INTERRUPT_WAIT_MS;
    while (talkingRef.current && Date.now() < until && !endedRef.current) await new Promise((r) => setTimeout(r, 150));
  };

  // Ask the interviewer model whether to say anything, given everything so far.
  const consult = useCallback(
    async (trigger: Trigger) => {
      if (endedRef.current) return;
      if (trigger === "wrapup") wrapAskedRef.current = true;
      if (trigger === "checkin" && modeRef.current !== "coach") return;
      if (busyRef.current) {
        // Queue it: the latest wins, except that a wrap-up beats a time check, which beats the rest.
        const rank = (t: Trigger | null) => (t === "wrapup" ? 2 : t === "time" ? 1 : 0);
        if (rank(trigger) >= rank(pendingRef.current)) pendingRef.current = trigger;
        return;
      }
      // A speech consult with nothing new to hear would just make the interviewer repeat itself.
      if (trigger === "speech" && !newSpeechRef.current) return;
      newSpeechRef.current = false;
      busyRef.current = true;
      lastContactRef.current = Date.now();
      setThinking(true);
      const minutesLeft = Math.max(0, Math.round((limitRef.current - now()) / 60000));
      const cutIn = trigger === "time" || trigger === "checkin"; // the interviewer speaks up unasked
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
      // Where the session is: still working, in the wrap-up question's thread, or after the closing question.
      const asked = (k: string) => tl.some((e) => e.type === "interviewer" && e.kind === k);
      const stage = asked("closing") ? "closing" : asked("wrapup") ? "wrapup" : "working";
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
        // Typing right after talking means they are working, not handing the floor over.
        secondsSinceEdit: Math.round((now() - codeHistoryRef.current[codeHistoryRef.current.length - 1].t) / 1000),
        minutesLeft,
        stage,
        elapsedMs: now(),
      });
      // The candidate is waiting on an answer: if the model is slow, make a small thinking sound.
      const think = { timer: null as ReturnType<typeof setTimeout> | null, done: null as Promise<void> | null };
      const awaited = trigger === "speech" && (answering || looksLikeQuestion(lastUtteranceRef.current.text));
      if (awaited && thinkingRef.current.length && Date.now() - lastThinkRef.current > THINKING_GAP_MS) {
        think.timer = setTimeout(() => {
          if (endedRef.current || talkingRef.current || speakingRef.current) return;
          lastThinkRef.current = Date.now();
          think.done = playClip(thinkingRef.current);
        }, THINKING_AFTER_MS);
      }
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
          if (trigger === "code" || trigger === "run" || trigger === "checkin") throw e;
          return ask();
        });
        if (think.timer) clearTimeout(think.timer);
        setThinking(false);
        if (endedRef.current) return;

        decisionsRef.current = reply.decisions;
        setDecisions(reply.decisions);

        // A question asked in reply to an answer is a follow-up, whatever the model called it.
        let kind: string = reply.kind;
        if (trigger === "time") kind = "time";
        else if (trigger === "checkin") kind = "redirect";
        else if (answering && kind === "probe") kind = "followup";
        else if (!answering && (kind === "followup" || kind === "ack")) kind = "other";
        const allowed =
          kind === "probe" ? probeAllowed
          : kind === "followup" ? followupsLeft > 0
          : kind === "closing" ? stage === "wrapup" && answering // asked once, after the wrap-up answer
          : true;
        // The candidate kept talking while we were deciding. Speaking now would cut across
        // them, and the reply is based on half of what they said. Their new speech has
        // already queued another consult, so drop this one. Time checks and check-ins are
        // meant to cut in, so they are kept.
        const stale = trigger !== "wrapup" && !cutIn && (lastActivityRef.current > sentTime || speechSeqRef.current !== sentSeq);
        let text = reply.action === "speak" && allowed && !stale ? reply.say : "";
        if (trigger === "time" && !text) text = timeLine(minutesLeft); // a time check is never skipped
        if (text) {
          hintRef.current = Math.max(hintRef.current, reply.hint_level);
          const g = reply.grounding?.code_quote || reply.grounding?.said_quote ? reply.grounding : undefined;
          if (kind === "probe" || kind === "followup" || kind === "wrapup") {
            lastProbeRef.current = now();
            setGrounding(g || null);
          }
          if (think.done) await think.done; // don't talk over our own "hmm"
          if (cutIn) await waitForGap();
          await say(text, kind, g, cutIn ? INTERRUPT_GRACE_MS : undefined);
        } else if (trigger === "speech" && !stale && !think.done) {
          // Nothing to say to a finished thought: acknowledge it with a quick "okay", the way a person on a call would.
          const last = lastUtteranceRef.current;
          const longEnough = last.text.split(/\s+/).length >= BACKCHANNEL_MIN_WORDS;
          const due = Date.now() - lastBackRef.current > BACKCHANNEL_GAP_MS;
          if (!last.typed && !looksLikeQuestion(last.text) && longEnough && due && backchannelsRef.current.length && !talkingRef.current && !speakingRef.current) {
            lastBackRef.current = Date.now();
            playClip(backchannelsRef.current);
          }
        }
        // Only count this code as looked at when the look could have led to a probe;
        // otherwise a passing "okay" would use up the candidate's new lines unseen.
        if (!stale && (trigger === "code" || kind === "probe")) lastCheckedCodeRef.current = sentCode;
      } catch (e) {
        console.error(e);
        if (think.timer) clearTimeout(think.timer);
        setThinking(false);
        if (think.done) await think.done;
        if (trigger === "time" || (trigger === "wrapup" && minutesLeft === 0)) {
          // The clock does not depend on the model: say the time anyway.
          await waitForGap();
          await say(timeLine(minutesLeft), trigger === "time" ? "time" : "other", undefined, INTERRUPT_GRACE_MS);
        }
        // Don't leave an answer hanging in silence when the model call failed twice.
        else if (answering && lastLine?.type === "interviewer") await say(SORRY_LINE, lastLine.kind);
      } finally {
        busyRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) consult(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    (text: string, start: number, end: number, isTyped = false, endOfTurn = false) => {
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
      lastUtteranceRef.current = { text, typed: isTyped };
      // The recognizer's own end-of-turn call has already weighed the pause, so consult almost at once.
      settleRef.current = isTyped ? 0 : endOfTurn ? TURN_SETTLE_MS : looksLikeQuestion(text) ? QUESTION_SETTLE_MS : SPEECH_SETTLE_MS;
      armSpeechTimer(settleRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addEvent, consult]
  );

  const stt = useSpeechRecognition(
    {
      onFinal: (text, s, e, info) => {
        // On speakers the mic can pick up our own backchannel or thinking sound; that is not the candidate.
        const echo = Date.now() - lastClipRef.current < 2500 && /^(okay|ok|i see|h+m+|let'?s see)[.!,]?$/i.test(text.trim());
        if (echo) return;
        const t0 = startRef.current;
        if (info?.words.length) wordsRef.current.push(info.words.map((w) => ({ w: w.w, s: w.s - t0, e: w.e - t0 })));
        onUtterance(text, s - t0, e - t0, false, info?.endOfTurn);
      },
      onActivity: () => {
        // Still talking: hold off consulting until they finish the thought. With end-of-turn
        // detection the recognizer says when that is; otherwise wait for quiet again.
        if (speechTimer.current) {
          if (turnsRef.current) {
            clearTimeout(speechTimer.current);
            speechTimer.current = null;
          } else armSpeechTimer(SPEECH_SETTLE_MS);
        }
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
  turnsRef.current = stt.turns;

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
    wrapAskedRef.current = false;
    startRef.current = lastContactRef.current = Date.now();
    setPhase("live");
    // The clock: time checks on the way, and the wrap-up question when time runs out.
    const limit = (limitRef.current = limitMin * 60000);
    timeTimers.current = TIME_CHECKS_MIN.filter((m) => m * 60000 < limit * 0.7).map((m) =>
      setTimeout(() => !wrapAskedRef.current && consult("time"), limit - m * 60000)
    );
    timeTimers.current.push(setTimeout(() => !wrapAskedRef.current && consult("wrapup"), limit));
    // Coach: when the interviewer has had no reason to look for a while, look anyway in case they are stuck.
    checkinTimer.current = setInterval(() => {
      if (modeRef.current !== "coach" || busyRef.current || speakingRef.current || wrapAskedRef.current) return;
      if (Date.now() - lastContactRef.current > CHECKIN_MS) consult("checkin");
    }, CHECKIN_TICK_MS);
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
          const listening = speakingRef.current && Date.now() - speakStartRef.current > graceRef.current;
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
    // Fetch the short clips one at a time, after the intro, to stay under the voice provider's concurrency limit.
    (async () => {
      for (const [phrases, into] of [[BACKCHANNELS, backchannelsRef], [THINKING_CLIPS, thinkingRef]] as const) {
        for (const phrase of phrases) {
          const url = await tts.preload(phrase);
          if (url) into.current.push(url);
        }
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
    [speechTimer, codeTimer, talkTimer, unmuteTimer].forEach((t) => t.current && clearTimeout(t.current));
    timeTimers.current.forEach(clearTimeout);
    if (checkinTimer.current) clearInterval(checkinTimer.current);
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    showReport(now());
  };

  // Computes metrics from the refs, switches to the report page, and asks for the written feedback.
  const showReport = async (sessionMs: number) => {
    const editTimes = codeHistoryRef.current.slice(1).map((s) => s.t);
    const m = computeMetrics(timelineRef.current, editTimes, sessionMs, wordsRef.current);
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
            <span className="timer">{clock(elapsed)} / {clock(limitMin * 60000)}</span>
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
            <div className="modes length">
              <span className="muted">Length</span>
              {SESSION_MINUTES.map((m) => (
                <button key={m} className={limitMin === m ? "on" : ""} onClick={() => setLimitMin(m)}>{m} min</button>
              ))}
            </div>
            <button className="primary" onClick={startSession}>Start interview</button>
            <p className="muted">Uses your microphone and camera. Works in Chrome. Headphones recommended.</p>
          </div>
        </div>
      )}
    </div>
  );
}
