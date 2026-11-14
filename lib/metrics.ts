import type { Metrics, TimelineEvent } from "./types";

const FILLERS = ["um", "umm", "uh", "uhh", "er", "like", "you know", "basically", "i mean", "kind of", "sort of", "actually", "literally"];

export function fillerBreakdown(text: string) {
  const lower = text.toLowerCase();
  return FILLERS.map((word) => ({
    word,
    count: (lower.match(new RegExp(`\\b${word}\\b`, "g")) || []).length,
  }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
}

// Stretches of typing with no speech nearby. An edit counts as narrated if the
// candidate spoke within 6s of it; a gap of more than 15s between edits ends a run.
export function silentRuns(events: TimelineEvent[], editTimes: number[]) {
  const speech = events.filter((e) => e.type === "speech");
  const runs: { start: number; end: number }[] = [];
  let narrated = 0;
  let open = false;
  for (let i = 0; i < editTimes.length; i++) {
    const t = editTimes[i];
    if (speech.some((e) => t >= e.start - 6000 && t <= e.end + 6000)) {
      narrated++;
      open = false;
    } else if (open && t - editTimes[i - 1] <= 15000) {
      runs[runs.length - 1].end = t;
    } else {
      runs.push({ start: t, end: t });
      open = true;
    }
  }
  return { runs, narrated };
}

export function computeMetrics(events: TimelineEvent[], editTimes: number[], sessionMs: number): Metrics {
  const speech = events.filter((e) => e.type === "speech");
  const spoken = speech.filter((e) => !e.typed); // typed fallback has no real timing

  const words = spoken.reduce((n, e) => n + e.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const speakingMs = spoken.reduce((n, e) => n + Math.max(1000, e.end - e.start), 0);
  const minutes = speakingMs / 60000;

  const breakdown = fillerBreakdown(speech.map((e) => e.text).join(" . "));
  const fillerCount = breakdown.reduce((n, f) => n + f.count, 0);
  const allSpeechMinutes = speech.reduce((n, e) => n + Math.max(1000, e.end - e.start), 0) / 60000;

  const { runs, narrated } = silentRuns(events, editTimes);
  const longest = runs.reduce((m, r) => Math.max(m, r.end - r.start), 0);

  return {
    sessionSeconds: Math.round(sessionMs / 1000),
    words,
    speakingSeconds: Math.round(speakingMs / 1000),
    wpm: minutes > 0.05 ? Math.round(words / minutes) : 0,
    fillerCount,
    fillersPerMinute: allSpeechMinutes > 0.05 ? Math.round((fillerCount / allSpeechMinutes) * 10) / 10 : 0,
    fillerBreakdown: breakdown,
    thinkAloudCoverage: editTimes.length ? narrated / editTimes.length : null,
    longestSilentCodingSeconds: Math.round(longest / 1000),
    utterances: speech.length,
  };
}
