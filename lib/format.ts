import type { TimelineEvent } from "./types";

export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function numberLines(code: string) {
  return code
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(2, " ")} | ${l}`)
    .join("\n");
}

// Transcript as the LLM sees it. Long stretches with no candidate speech are
// marked so the model can tell what was written without being talked about.
export function formatTimeline(events: TimelineEvent[]) {
  const lines: string[] = [];
  let lastSpeechEnd = 0;
  for (const e of events) {
    if (e.type === "speech") {
      const gap = e.start - lastSpeechEnd;
      if (gap > 20000) lines.push(`        (candidate said nothing for ${Math.round(gap / 1000)}s)`);
      lines.push(`[${clock(e.start)}] CANDIDATE: ${e.text}`);
      lastSpeechEnd = e.end;
    } else if (e.type === "interviewer") {
      lines.push(`[${clock(e.t)}] INTERVIEWER (${e.kind}): ${e.text}`);
    } else {
      lines.push(`[${clock(e.t)}] (candidate ran the code: ${e.summary})`);
    }
  }
  return lines.join("\n") || "(nothing said yet)";
}
