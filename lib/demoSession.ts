import type { CodeSnapshot, Decision, RunResult, TimelineEvent } from "./types";
import { problem } from "./problem";

// A canned session, loaded by /?demo, for working on the report and replay
// without doing a live interview. There is no audio.
const s = (sec: number) => sec * 1000;

const LINES = [
  "def two_sum(nums, target):",
  "    seen = {}",
  "    for i, num in enumerate(nums):",
  "        if target - num in seen:",
  "            return [seen[target - num], i]",
  "        seen[num] = i",
];

// [second, number of lines written by then]
const TYPING: [number, number][] = [[44, 2], [52, 3], [62, 4], [73, 5], [84, 6]];

const codeHistory: CodeSnapshot[] = [{ t: 0, code: problem.starterCode }];
for (const [sec, n] of TYPING) {
  // a few keystrokes leading up to each finished line, so typing shows as activity
  const done = LINES.slice(0, n - 1).join("\n") + "\n";
  const line = LINES[n - 1];
  [0.3, 0.6, 1].forEach((frac, i) =>
    codeHistory.push({ t: s(sec - 6 + i * 3), code: done + line.slice(0, Math.ceil(line.length * frac)) + "\n" })
  );
}

const timeline: TimelineEvent[] = [
  { type: "interviewer", t: 0, kind: "intro", text: problem.intro },
  { type: "speech", t: s(16), start: s(16), end: s(19), text: "can there be duplicate numbers in the array" },
  { type: "interviewer", t: s(21), kind: "clarification", text: "Yes, two different elements can have the same value, but you can't use the same element twice." },
  { type: "speech", t: s(27), start: s(27), end: s(38), text: "okay um so the brute force would be like two nested loops checking every pair, that's n squared. I think I can do better with a hash map, I'll store the numbers as I go" },
  { type: "speech", t: s(42), start: s(42), end: s(47), text: "so I'll loop through with enumerate so I have the index" },
  {
    type: "interviewer", t: s(92), kind: "probe",
    text: "Earlier you said you'd store the numbers as you go, but on line 4 you check for the complement before you store anything. Why that order?",
    grounding: { code_quote: "if target - num in seen:", said_quote: "I'll store the numbers as I go" },
  },
  { type: "speech", t: s(101), start: s(101), end: s(108), text: "uh because I need to find the other number first, basically if it's already in there I can return right away" },
  { type: "run", t: s(115), passed: 5, total: 5, summary: "5/5 tests passed" },
  { type: "speech", t: s(118), start: s(118), end: s(123), text: "okay it passes all five so that's linear time and linear space" },
  { type: "interviewer", t: s(128), kind: "wrapup", text: "On line 6 you store the index as the value. What would change if the same number appeared twice in the array?" },
  { type: "speech", t: s(137), start: s(137), end: s(146), text: "um it would overwrite the earlier index, but I think that's fine because we check before we store" },
];

const decisions: Decision[] = [
  { id: "d1", description: "Uses a hash map from value to index instead of nested loops", code_quote: "seen = {}", explained: false, said_quote: "I think I can do better with a hash map" },
  { id: "d2", description: "Iterates with enumerate to keep the index", code_quote: "for i, num in enumerate(nums):", explained: true, said_quote: "so I'll loop through with enumerate so I have the index" },
  { id: "d3", description: "Looks up the complement before inserting the current number", code_quote: "if target - num in seen:", explained: false, said_quote: "because I need to find the other number first" },
];

const run: RunResult = {
  error: null,
  stdout: "",
  passed: 5,
  total: 5,
  results: problem.tests.map(([nums, target, expected]) => ({
    input: `nums = [${nums.join(", ")}], target = ${target}`,
    expected: `[${expected.join(", ")}]`,
    got: `[${expected.join(", ")}]`,
    ok: true,
  })),
};

export const demoSession = { timeline, codeHistory, decisions, run, durationMs: s(150) };
