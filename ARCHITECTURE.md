# Mock technical interview simulator: architecture

Built for the AI@USC hackathon (https://ai-usc.devpost.com/). See [OPEN_ISSUES.md](OPEN_ISSUES.md) for what is untested or unfinished.

## What it is and why

The hardest part of going from LeetCode to real interviews is explaining your thinking out loud, not solving the problem. This app is a voice-driven interview room that trains that skill.

What makes it different from "mock interview with ChatGPT":

- The interviewer hears the candidate **and** sees the live editor, and asks follow-ups that depend on both. Example from a real test run: *"Earlier you said you would store the numbers as you go, but on line 4 you are checking the complement before inserting on line 6. Why do the lookup before storing?"*
- It knows when to stay quiet. Thinking aloud and pauses get no response.
- The end report quotes what the candidate actually said and wrote, and measures delivery (pace, fillers, how much of the coding was narrated).

Scope is deliberately small: one problem (Two Sum), one language (Python), two modes. It is hackathon code: no tests, no hardening.

## Running it

```
cp .env.example .env.local    # then fill in the two keys
npm install
npm run dev                   # open http://localhost:3000 in Chrome
```

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Any OpenAI-compatible chat endpoint. Currently Gemini (`gemini-3.5-flash-lite`) through Google's OpenAI-compatible URL. Changing provider means changing these three. |
| `REPORT_MODEL` | Stronger, slower model for the end report and redo grading (currently `gemini-3.8-flash`, about 5 to 9s per call). Falls back to `LLM_MODEL` if unset or if the call fails. The live interviewer always uses `LLM_MODEL` for speed. |
| `TTS_PROVIDER` | `elevenlabs` or `browser` (Chrome's built-in voice, no key). |
| `TTS_API_KEY` | ElevenLabs key. |
| `TTS_VOICE`, `TTS_MODEL` | Optional ElevenLabs voice id and model id. |

Chrome is required: speech-to-text uses the Web Speech API. Restart the dev server after editing `.env.local`.

## Stack

- Next.js (App Router, TypeScript). One process serves the UI and the API routes, so keys stay on the server.
- `@monaco-editor/react` for the editor.
- Pyodide (Python in WebAssembly, loaded from CDN) runs the candidate's code in the browser.
- Chrome Web Speech API for speech-to-text. ElevenLabs for the interviewer's voice, with the browser voice as fallback.
- `openai` SDK pointed at an OpenAI-compatible base URL for all LLM calls, in JSON mode.

## The two modes

| | Interview | Coach |
|---|---|---|
| Clarifying questions | Answered factually | Answered factually |
| Hints | Declined neutrally | Three-step ladder: nudge, then name the technique, then one specific step |
| Unexplained decisions in the code | Noted silently, saved for wrap-up | One short probe, at most every 25 seconds |
| Wrap-up | One neutral follow-up on correctness or complexity | One follow-up grounded in code and speech |

## How a session flows

```
Browser (app/page.tsx)                                Server (app/api/*)
──────────────────────                                ──────────────────
mic ──► useSpeechRecognition ──► timeline (speech)
editor ──► code + edit timestamps
Run ──► usePyodide ──► timeline (run)

trigger fires ──► POST /api/interviewer ─────────────► builds prompt, calls LLM
   (mode, trigger, code, timeline, run,                returns { action, kind, say,
    decision ledger, hint level, probeAllowed)                   grounding, decisions,
                                                                 hint_level }
◄── reply
   update ledger; if "speak": POST /api/tts ─────────► ElevenLabs ──► audio
   play audio (mic results ignored meanwhile)

End ──► computeMetrics (local)
    ──► POST /api/report ─────────────────────────────► calls LLM, verifies quotes
◄── report ──► components/Report.tsx
```

The server is stateless. The browser holds all session state and sends it on every call.

### When the interviewer is consulted

Silence alone never triggers a call.

| Trigger | When | Modes |
|---|---|---|
| `speech` | Candidate finished an utterance, then 1.5s of quiet | Both |
| `code` | At least 2 new meaningful lines since the last check, 4s with no typing, candidate not talking, probe cooldown elapsed | Coach |
| `run` | Candidate clicked Run tests | Coach |
| `wrapup` | Candidate clicked "I'm done" | Both |

The opening line is fixed text (`problem.intro`), not an LLM call.

Only one consult runs at a time; a trigger that arrives meanwhile is queued (latest wins, `wrapup` is never displaced). The timing constants are at the top of [app/page.tsx](app/page.tsx).

### The decision ledger (the core mechanism)

On every call the model returns the full list of decisions visible in the code, each with:

- `code_quote`: the exact line
- `explained`: true only if the candidate said **why**, not just what
- `said_quote`: their explanation, or the closest related thing they said, or empty

The browser sends the ledger back on the next call. Probes may only target a decision that is in the code and unexplained, and the reply's `grounding` carries the code line and the earlier quote the question was built on. The UI shows that as a "Why I asked" chip, which is what demonstrates to judges that both inputs mattered. The ledger is also the main input to the report.

### Guard rails enforced in the browser, not left to the prompt

- `probeAllowed` is computed client-side (Coach mode and cooldown elapsed, or wrap-up). A probe that comes back when it was not allowed is dropped.
- A probe is dropped if the candidate started talking or anything new was logged while the model was deciding.
- Interview mode never sends `code` or `run` triggers at all.
- Mic results are discarded while the interviewer's audio is playing, plus 400ms, so it does not transcribe itself.

### Avatar states

`speaking` (audio playing) › `thinking` (LLM call in flight) › `listening` (interim speech results arriving) › `waiting` (everything else).

## Delivery metrics

Computed locally in [lib/metrics.ts](lib/metrics.ts), no LLM involved:

- **Words per minute** over actual speaking time (first interim result to final result per utterance).
- **Filler words**: count, rate per minute, and breakdown. List: um, uh, er, like, you know, basically, I mean, kind of, sort of, actually, literally.
- **Think-aloud coverage**: share of editor keystrokes that had speech within 6 seconds.
- **Longest silent coding stretch**: longest run of un-narrated edits with gaps under 15 seconds.

Utterances entered through the typed fallback box are excluded from pace.

## Report

`/api/report` gets the timeline, final code, test results, ledger, and metrics, and returns:

- A two-sentence summary.
- Scores from 1 to 4 with a one-line reason each: correctness (framed as a code review plus test results), edge cases, complexity and tradeoffs, clarity of reasoning.
- Exactly one strength, one missed explanation, one retry exercise. Each carries an `evidence` quote tagged `said` or `wrote`.
- A short reading of the delivery metrics.

The server then checks that each quote really appears in the transcript or code (case and punctuation ignored) and sets `verified`. The report page labels unverified quotes "(paraphrased)". The page also shows the metrics, the ledger as an explained / not-explained checklist, and the final code.

## Replay and redo

The report page has a **replay**: a scrubbable timeline of the session where code, transcript and audio move together.

- **What is recorded during the session** (all in the browser, nothing persisted):
  - `codeHistory`: the editor contents after every edit, with timestamps. This replaced the old list of edit timestamps and also feeds the metrics.
  - The mic, with `MediaRecorder`, as one audio blob for the whole session.
  - Each interviewer line's audio blob URL (`audioUrl` on the timeline event), when the premium voice was used.
- **Timeline lanes:** you talking, interviewer (probes in purple), typing bursts, with stretches of typing in silence (8s or more) hatched in red. Test runs and unexplained decisions (⚑) are pinned on it.
- **Playback** is driven by the component's own clock, not the audio element, so it works when there is no recording. The mic audio is slaved to that clock, and interviewer lines play as the playhead reaches them. Speeds: 1×, 1.5×, 2×.
- Clicking the track or a transcript line seeks. The code pane shows the editor as it was at the playhead.

**Redo the moment.** Each unexplained decision becomes a redo target placed at the time its line first appeared in the editor. The candidate sees the code as it was then (line highlighted) and what they said within 30s of it, records up to 45s re-explaining it, and `/api/redo` grades the retake against the first attempt: explained or not, a 1 to 4 score, what improved (quoting the retake), what is still missing, and a model answer shown only after an attempt. A passing retake marks the decision "Explained on your retake" in the ledger. Entry points: the ⚑ moments under the timeline, the ledger, the report's "Missed explanation" box, and "Redo from here" at any playhead position (targets whatever was written in the previous 30s).

**Demo data:** opening `/?demo` loads a canned session ([lib/demoSession.ts](lib/demoSession.ts)) straight into the report, without audio. Use it to work on the report, replay and redo without doing an interview.

## File map

| Path | What it does |
|---|---|
| [app/page.tsx](app/page.tsx) | The interview room and all orchestration: triggers, consult queue, session start and end |
| [components/Report.tsx](components/Report.tsx) | Report page; builds the redo targets from the ledger and code history |
| [components/Replay.tsx](components/Replay.tsx) | Scrubbable session timeline with synced code, transcript and audio |
| [components/Redo.tsx](components/Redo.tsx) | Re-record and grade one moment |
| [app/api/redo/route.ts](app/api/redo/route.ts) | Grades a retake against the first attempt |
| [lib/demoSession.ts](lib/demoSession.ts) | Canned session for `/?demo` |
| [app/api/interviewer/route.ts](app/api/interviewer/route.ts) | Builds the interviewer prompt, calls the LLM, normalizes the reply |
| [app/api/report/route.ts](app/api/report/route.ts) | Builds the report prompt, calls the LLM, verifies quotes |
| [app/api/tts/route.ts](app/api/tts/route.ts) | Proxies ElevenLabs; a non-200 response tells the client to use the browser voice |
| [lib/prompts.ts](lib/prompts.ts) | Interviewer system prompt (shared rules plus per-mode rules) and report prompt. **Most behavior tuning happens here.** |
| [lib/problem.ts](lib/problem.ts) | Two Sum: statement, starter code, tests, spoken intro, and interviewer-only notes (clarification answers, decisions worth explaining, edge cases) |
| [lib/types.ts](lib/types.ts) | Shared types: `TimelineEvent`, `Decision`, `InterviewerReply`, `Metrics`, `Report` |
| [lib/metrics.ts](lib/metrics.ts) | Delivery metrics |
| [lib/format.ts](lib/format.ts) | Turns the timeline into the transcript the LLM reads; numbers code lines |
| [lib/llm.ts](lib/llm.ts) | `chatJSON()`: one LLM call in JSON mode, with optional model override and fallback to the fast model |
| [hooks/useSpeechRecognition.ts](hooks/useSpeechRecognition.ts) | Continuous Chrome speech-to-text with auto-restart and muting |
| [hooks/useTTS.ts](hooks/useTTS.ts) | `speak(text)`, resolves when audio finishes and returns the audio blob URL for replay; falls back to browser voice |
| [hooks/usePyodide.ts](hooks/usePyodide.ts) | Loads Pyodide and runs the code against the tests |

## Common changes

- **Interviewer too chatty, too quiet, or too generic:** edit [lib/prompts.ts](lib/prompts.ts). Avoid putting literal example sentences in the prompt; the model repeats them word for word. Describe the shape instead.
- **Timing of probes:** `SPEECH_SETTLE_MS`, `CODE_SETTLE_MS`, `PROBE_COOLDOWN_MS` in [app/page.tsx](app/page.tsx).
- **Different or additional problem:** add an object like the one in [lib/problem.ts](lib/problem.ts). The test harness in `usePyodide` assumes a `(nums, target)` signature and order-insensitive comparison, so it needs generalizing for other problems.
- **Different LLM:** change the three `LLM_*` variables. The provider must support `response_format: { type: "json_object" }`.

## Demo script

1. Start in Coach mode. The interviewer reads the problem.
2. Ask "can there be duplicates?" and get a direct answer.
3. Say "I'll use a hash map to store numbers as I go", then write the loop silently. A few seconds after you stop typing, the interviewer asks about lookup-before-insert, and the "Why I asked" chip shows the line and your quote.
4. Think aloud, then pause. The interviewer stays silent.
5. Ask for a hint twice; the second is more specific.
6. Run tests, click "I'm done", answer the follow-up, then "End & get report".
7. On the report, press Play on the replay, click a ⚑ moment, and "Redo this moment". Give a weak explanation first, then a good one, to show the grading change.
