import type { Metrics, TimelineEvent } from "./types";

const FILLERS = ["um", "umm", "uh", "uhh", "er", "like", "you know", "basically", "i mean", "kind of", "sort of", "actually", "literally"];

export function computeMetrics(events: TimelineEvent[], editTimes: number[], sessionMs: number): Metrics {
  const speech = events.filter((e) => e.type === "speech");
  const spoken = speech.filter((e) => !e.typed); // typed fallback has no real timing
  const text = speech.map((e) => e.text.toLowerCase()).join(" . ");

  const words = spoken.reduce((n, e) => n + e.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const speakingMs = spoken.reduce((n, e) => n + Math.max(1000, e.end - e.start), 0);
  const minutes = speakingMs / 60000;

  const fillerBreakdown = FILLERS.map((word) => ({
    word,
    count: (text.match(new RegExp(`\\b${word}\\b`, "g")) || []).length,
  }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
  const fillerCount = fillerBreakdown.reduce((n, f) => n + f.count, 0);
  const allSpeechMinutes = speech.reduce((n, e) => n + Math.max(1000, e.end - e.start), 0) / 60000;

  // An edit counts as narrated if the candidate spoke within 6s of it.
  const narrated = (t: number) => speech.some((e) => t >= e.start - 6000 && t <= e.end + 6000);
  const flags = editTimes.map(narrated);
  let longest = 0;
  let runStart: number | null = null;
  editTimes.forEach((t, i) => {
    const prev = editTimes[i - 1];
    if (flags[i]) runStart = null;
    else {
      if (runStart === null || (prev !== undefined && t - prev > 15000)) runStart = t;
      longest = Math.max(longest, t - runStart);
    }
  });

  return {
    sessionSeconds: Math.round(sessionMs / 1000),
    words,
    speakingSeconds: Math.round(speakingMs / 1000),
    wpm: minutes > 0.05 ? Math.round(words / minutes) : 0,
    fillerCount,
    fillersPerMinute: allSpeechMinutes > 0.05 ? Math.round((fillerCount / allSpeechMinutes) * 10) / 10 : 0,
    fillerBreakdown,
    thinkAloudCoverage: editTimes.length ? flags.filter(Boolean).length / editTimes.length : null,
    longestSilentCodingSeconds: Math.round(longest / 1000),
    utterances: speech.length,
  };
}
