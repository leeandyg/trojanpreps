export type Mode = "interview" | "coach";
export type AvatarState = "listening" | "waiting" | "thinking" | "speaking";
export type Trigger = "speech" | "code" | "run" | "wrapup";

export type Grounding = { code_quote: string; said_quote: string };

// t / start / end are milliseconds since the session started.
export type TimelineEvent =
  | { type: "speech"; t: number; start: number; end: number; text: string; typed?: boolean }
  | { type: "interviewer"; t: number; text: string; kind: string; grounding?: Grounding }
  | { type: "run"; t: number; passed: number; total: number; summary: string };

export type Decision = {
  id: string;
  description: string;
  code_quote: string;
  explained: boolean;
  said_quote: string;
};

export type InterviewerReply = {
  action: "speak" | "stay_silent";
  kind: "clarification" | "hint" | "probe" | "wrapup" | "other";
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
