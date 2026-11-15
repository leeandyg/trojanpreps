import type { Metrics, SpokenWord, TimelineEvent } from "./types";

// Deepgram transcribes hesitations as "um"/"uh" (filler_words=true); the Chrome fallback mostly drops them.
const FILLERS = ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "like", "you know", "basically", "i mean", "kind of", "sort of", "actually", "literally"];

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

const PAUSE_MS = 1500; // a gap this long between two words of one turn counts as a mid-sentence pause
const PACE_MIN_WORDS = 8; // turns shorter than this are too short to time
const HALF_MIN_WORDS = 15; // words needed in each half of the session to compare early and late pace
const HOTSPOT_WINDOW_MS = 30000;
const HOTSPOT_MIN = 3;

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");

// Pause, pace and filler-cluster numbers from word timings. `turns` is one array of
// words per recognizer turn, times in session ms. All null when there are no timings.
export function timingMetrics(turns: SpokenWord[][], sessionMs: number) {
  turns = turns.filter((t) => t.length);
  if (!turns.length)
    return { midSentencePauses: null, longestPauseSeconds: 0, paceSlowest: null, paceFastest: null, paceEarlyWpm: null, paceLateWpm: null, fillerHotspot: null };

  let pauses = 0;
  let longestPause = 0;
  const fillerTimes: number[] = [];
  const paces: { t: number; wpm: number }[] = [];
  const halves = [{ words: 0, ms: 0 }, { words: 0, ms: 0 }];
  for (const turn of turns) {
    for (let i = 0; i < turn.length; i++) {
      const gap = i ? turn[i].s - turn[i - 1].e : 0;
      if (gap >= PAUSE_MS) {
        pauses++;
        longestPause = Math.max(longestPause, gap);
      }
      const one = bare(turn[i].w);
      const two = i + 1 < turn.length ? `${one} ${bare(turn[i + 1].w)}` : "";
      if (FILLERS.includes(one) || FILLERS.includes(two)) fillerTimes.push(turn[i].s);
    }
    const ms = Math.max(1, turn[turn.length - 1].e - turn[0].s);
    if (turn.length >= PACE_MIN_WORDS) paces.push({ t: turn[0].s, wpm: Math.round(turn.length / (ms / 60000)) });
    const half = halves[turn[0].s < sessionMs / 2 ? 0 : 1];
    half.words += turn.length;
    half.ms += ms;
  }

  // The 30s window holding the most fillers; a window can always start on a filler.
  fillerTimes.sort((a, b) => a - b);
  let hotspot: { t: number; count: number } | null = null;
  fillerTimes.forEach((t, i) => {
    const count = fillerTimes.filter((x, j) => j >= i && x < t + HOTSPOT_WINDOW_MS).length;
    if (count >= HOTSPOT_MIN && count > (hotspot?.count ?? 0)) hotspot = { t, count };
  });

  const byPace = [...paces].sort((a, b) => a.wpm - b.wpm);
  const halfWpm = (h: { words: number; ms: number }) => Math.round(h.words / (h.ms / 60000));
  const bothHalves = halves.every((h) => h.words >= HALF_MIN_WORDS);
  return {
    midSentencePauses: pauses,
    longestPauseSeconds: Math.round(longestPause / 100) / 10,
    paceSlowest: byPace.length >= 2 ? byPace[0] : null,
    paceFastest: byPace.length >= 2 ? byPace[byPace.length - 1] : null,
    paceEarlyWpm: bothHalves ? halfWpm(halves[0]) : null,
    paceLateWpm: bothHalves ? halfWpm(halves[1]) : null,
    fillerHotspot: hotspot as { t: number; count: number } | null,
  };
}

export function computeMetrics(events: TimelineEvent[], editTimes: number[], sessionMs: number, turns: SpokenWord[][] = []): Metrics {
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
    ...timingMetrics(turns, sessionMs),
  };
}
