export type Mode = "interview" | "coach";
export type AvatarState = "listening" | "waiting" | "thinking" | "speaking";
// "time": a scheduled time check. "checkin": coach-mode periodic look for a candidate who is stuck or on a dead end.
export type Trigger = "speech" | "code" | "run" | "wrapup" | "time" | "checkin";

// One recognized word with its timing. In the speech hook s/e are Date.now() values;
// the page stores them as milliseconds since the session started.
export type SpokenWord = { w: string; s: number; e: number };

export type Grounding = { code_quote: string; said_quote: string };

// t / start / end are milliseconds since the session started.
export type TimelineEvent =
  | { type: "speech"; t: number; start: number; end: number; text: string; typed?: boolean }
  // audioUrl is a browser blob URL of the spoken line, kept so the replay can play it back
  | { type: "interviewer"; t: number; text: string; kind: string; grounding?: Grounding; audioUrl?: string; interrupted?: boolean }
  | { type: "run"; t: number; passed: number; total: number; summary: string };

// The editor contents after each edit, for replay.
export type CodeSnapshot = { t: number; code: string };

// A point in the session the candidate can re-explain.
export type RedoTarget = {
  key: string;
  t: number;
  description: string; // what to explain
  code_quote: string; // the line(s) it is about
  code: string; // editor contents at that moment
  firstSaid: string; // what the candidate said around then, possibly empty
};

export type RedoResult = {
  retake: string;
  explained: boolean;
  score: number; // 1..4
  verdict: string;
  improved: string;
  still_missing: string;
  model_answer: string;
  wpm: number;
  fillers: number;
};

export type Decision = {
  id: string;
  description: string;
  code_quote: string;
  explained: boolean;
  said_quote: string;
};

export type InterviewerReply = {
  action: "speak" | "stay_silent";
  // "followup" and "ack" only occur in reply to the candidate answering the interviewer's question
  // "closing" is the reflective question after the wrap-up answer, "signoff" the goodbye after it
  // "time" is a time check, "redirect" is the interviewer stepping in on a dead end
  kind: "clarification" | "hint" | "probe" | "followup" | "ack" | "wrapup" | "time" | "redirect" | "closing" | "signoff" | "other";
  say: string;
  grounding?: Grounding;
  decisions: Decision[];
  hint_level: number;
};

export type TestResult = {
  input: string;
  expected: string;
  got: string;
  ok: boolean;
};

export type RunResult = {
  error: string | null;
  stdout: string;
  results: TestResult[];
  passed: number;
  total: number;
};

export type Metrics = {
  sessionSeconds: number;
  words: number;
  speakingSeconds: number;
  wpm: number;
  fillerCount: number;
  fillersPerMinute: number;
  fillerBreakdown: { word: string; count: number }[];
  thinkAloudCoverage: number | null; // 0..1, share of edits with speech nearby
  longestSilentCodingSeconds: number;
  utterances: number;
  // From word timings (Deepgram only); null when there are none (Chrome fallback, typed input, demo session).
  midSentencePauses: number | null; // gaps of 1.5s or more between words inside one turn
  longestPauseSeconds: number;
  paceSlowest: { t: number; wpm: number } | null; // slowest and fastest turn of 8+ words; t is session ms
  paceFastest: { t: number; wpm: number } | null;
  paceEarlyWpm: number | null; // average pace in the first and second half of the session
  paceLateWpm: number | null;
  fillerHotspot: { t: number; count: number } | null; // the 30s window with the most fillers, if 3 or more
};

export type Evidence = { source: "said" | "wrote"; quote: string; verified?: boolean };

export type Report = {
  summary: string;
  scores: Record<
    "correctness" | "edge_cases" | "complexity_tradeoffs" | "clarity",
    { score: number; why: string }
  >;
  strength: { observation: string; evidence: Evidence };
  missed_explanation: { observation: string; evidence: Evidence };
  retry_exercise: { exercise: string; evidence: Evidence };
  delivery: string;
};
