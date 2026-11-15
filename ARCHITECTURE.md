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
| `STT_API_KEY` | Deepgram key for speech-to-text. Needs Member role or higher (the server mints 60s browser tokens from it). If unset or Deepgram fails, Chrome's Web Speech API is used instead. |
| `TTS_PROVIDER` | `elevenlabs` or `browser` (Chrome's built-in voice, no key). |
| `TTS_API_KEY` | ElevenLabs key. |
| `TTS_VOICE`, `TTS_MODEL` | Optional ElevenLabs voice id and model id. |

Chrome is the supported browser (Deepgram streaming works anywhere with `MediaRecorder`, but the fallback recognizer and the rest of the app are only checked in Chrome). Restart the dev server after editing `.env.local`.

## Stack

- Next.js (App Router, TypeScript). One process serves the UI and the API routes, so keys stay on the server.
- `@monaco-editor/react` for the editor.
- Pyodide (Python in WebAssembly, loaded from CDN) runs the candidate's code in the browser.
- Deepgram Flux streaming for speech-to-text and end-of-turn detection (browser connects directly with a short-lived token from `/api/stt-token`; keyterm list for CS vocabulary; keeps "um"/"uh"; word timings). Chrome Web Speech API as fallback.
- `openai` SDK pointed at an OpenAI-compatible base URL for all LLM calls, in JSON mode.

## The two modes

| | Interview | Coach |
|---|---|---|
| Clarifying questions | Answered factually | Answered factually |
| Hints | Declined neutrally | Three-step ladder: nudge, then name the technique, then one specific step |
| Unexplained decisions in the code | Noted silently, saved for wrap-up | One short probe, at most every 25 seconds |
| Candidate answers the interviewer's question | Neutral acknowledgement, or a neutral narrower follow-up; never says right or wrong | Confirms a good answer and hands back; follows up on a weak one (up to 2 times), then states the missing point and moves on |
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

Most calls follow something the candidate did. Two are on a clock: time checks, and in Coach mode a check-in after a minute without contact.

| Trigger | When | Modes |
|---|---|---|
| `speech` | Deepgram says the candidate's turn ended, then 0.3s (`TURN_SETTLE_MS`). On the Chrome fallback: an utterance, then 1.5s of quiet (0.6s if it sounds like a direct question) | Both |
| `code` | At least 2 new meaningful lines since the last check, 4s with no typing, candidate not talking, probe cooldown elapsed | Coach |
| `run` | Candidate clicked Run tests | Coach |
| `wrapup` | Candidate clicked "I'm done", or the session clock ran out (`minutes_left` 0) | Both |
| `time` | 5 and 2 minutes before the session limit (only checks under 70% of the limit; a 5-minute session gets the 2-minute one) | Both |
| `checkin` | 60s (`CHECKIN_MS`) with no consult and no interviewer line | Coach |

The opening line is fixed text (`problem.intro`), not an LLM call. The time-check fallback lines are fixed text too.

Only one consult runs at a time; a trigger that arrives meanwhile is queued (latest wins, except `wrapup` beats `time`, which beats the rest). Every consult also sends `minutesLeft`, `elapsedMs`, `secondsSinceEdit` and `stage`. The timing constants are at the top of [app/page.tsx](app/page.tsx).

### When the candidate hands over the floor

The interviewer replies to more than explicit questions. On every `speech` consult the model first classifies the latest speech in a `turn` field: `question`, `handed_over` (a complete statement that wraps something up, such as a reason, a plan or a complexity claim, followed by quiet rather than typing; the browser sends `secondsSinceEdit` for this), or `mid_thought`. For `question` and `handed_over` it must speak; for `mid_thought` it stays silent.

`gemini-3.5-flash-lite` classifies well but often still leaves `say` empty. So [app/api/interviewer/route.ts](app/api/interviewer/route.ts) enforces it: if the model's own `turn` says the candidate is waiting and `say` is empty, it asks once more for the words (one extra call, only in that case). The model has no `action` field any more; it speaks by filling `say`, and the route derives `action`.

The reply responds to what they said and stays neutral about correctness unless a mode rule says otherwise. Probes in reply still obey `probeAllowed`.

### Personality

The prompt asks for an engaged, warm colleague: short reactions tied to what the candidate actually did, never generic praise and not on every turn. Coach may confirm that something is right and show interest in a clever approach (including a brief reaction when all tests pass). Interview may be warm but never signals right or wrong.

### Session clock, time checks and cutting in

The lobby offers a 5, 10 or 20 minute session (`SESSION_MINUTES`, default 10); the timer shows elapsed / limit. The session does not end by itself.

- **Time checks** (`time` trigger) always produce a spoken line with the minutes left, plus one prioritisation nudge if the candidate is far from working code (neutral in Interview). If the model stays silent or fails, a fixed line is spoken instead.
- **Time up:** at the limit, if wrap-up has not been asked, the wrap-up consult runs and opens by saying time is up.
- **Dead ends (Coach):** on every call the model sets `stuck` (same tests failing across runs with no change of approach, over a minute on an approach that cannot work, or well over a minute of no speech and no edits). When true it steps in with a question that exposes the problem, kind `redirect`. The 60s `checkin` trigger exists so this can happen while the candidate is silent.
- **Cutting in:** `time` and `checkin` replies are not dropped as stale. They wait up to 5s (`INTERRUPT_WAIT_MS`) for the candidate to stop talking, then speak with a 2s barge-in grace (`INTERRUPT_GRACE_MS`) so trailing words do not cut the interviewer off.

### Opening and closing

The opening line (`problem.intro`) is warm and ends by asking whether they have questions before starting. After the candidate answers the wrap-up question, the interviewer asks one reflective closing question (kind `closing`: what they would change with more time), then replies to that answer with a short sign-off pointing to the report (kind `signoff`). The browser sends `stage` (`working`, `wrapup`, `closing`) and only allows a `closing` line once, in reply to the wrap-up answer.

### When the candidate answers a question

The browser works out whether the candidate's latest speech is an answer: the most recent interviewer line was a `probe`, `followup` or `wrapup`, and the candidate has spoken since. It sends `answering: true` and `followupsLeft` (starts at `MAX_FOLLOWUPS` = 2, minus follow-ups already asked on this question).

The model must then respond rather than stay silent, with one of:

- `ack`: the answer gave a correct reason. The decision is marked explained in the ledger and the interviewer hands the floor back in one short sentence.
- `followup`: the answer was vague, only restated the code, or was wrong. One short question aimed at the gap. Not subject to the probe cooldown.
- `stay_silent`: the candidate is still thinking ("hmm, let me think"), so wait.
- `clarification`: the candidate asked something back.

When follow-ups run out the interviewer stops pressing and moves on. The browser enforces the limit and relabels a `probe` that arrives while answering as a `followup`.

### One thought, one transcript block

Deepgram Flux delivers one transcript per turn, ending a turn when its model judges the thought finished (`eot_threshold` 0.75) or after 4s of silence; the Chrome fallback finalizes at every small pause. Pieces less than `MERGE_GAP_MS` (2.5s) apart with nothing in between are joined into one speech event, for both the on-screen transcript and what the model reads.

### Making the conversation feel live

Still turn-based underneath (speech-to-text, then the model, then a voice), with these layered on so it does not feel like it:

- **Streaming voice.** `/api/tts` uses ElevenLabs' streaming endpoint and `useTTS` plays the audio as bytes arrive (through `MediaSource`), so the interviewer starts speaking after about 0.3s instead of after the whole clip downloads.
- **Mute starts when sound starts.** The mic is muted from the moment audio actually plays, not from when the audio is requested, and the barge-in grace period counts from then too.
- **Barge-in.** The mic's loudness is watched during the session ([hooks/voiceActivity.ts](hooks/voiceActivity.ts)) on a stream with echo cancellation. If the candidate talks over the interviewer (louder than `BARGE_RMS` for `BARGE_HOLD_MS`), the interviewer's audio stops at once, the mic is unmuted, and the line is marked `interrupted` so the model knows it was cut off.
- **Backchannels.** Two neutral clips ("Okay.", "I see.") are fetched once after the intro; nothing that sounds like agreement, since the reasoning may be wrong. One plays when a `speech` consult comes back silent after a spoken thought of 15 or more words that is not a question, at most every 35s. They are not logged in the transcript and are skipped when the browser voice is in use.
- **Thinking sounds.** Two clips ("Hmm.", "Let's see.") fetched the same way. If the candidate is waiting on an answer (they asked a question or answered one) and the model has not replied after 1.2s (`THINKING_AFTER_MS`), one plays, at most every 30s; the spoken reply waits for it to finish.
- **End-of-turn detection.** With Deepgram the consult starts 0.3s after the recognizer says the turn is over, and new speech cancels a pending consult. On the Chrome fallback the old silence timers apply (1.5s, or 0.6s for something that looks like a question, `looksLikeQuestion`).

Deliberately not built: starting the model call early on a partial transcript. It would cut latency further but spends tokens on calls that get thrown away.

### The decision ledger (the core mechanism)

On every call the model returns the full list of decisions visible in the code, each with:

- `code_quote`: the exact line
- `explained`: true only if the candidate said **why**, not just what
- `said_quote`: their explanation, or the closest related thing they said, or empty

The browser sends the ledger back on the next call. Probes may only target a decision that is in the code and unexplained, and the reply's `grounding` carries the code line and the earlier quote the question was built on. The UI shows that as a "Why I asked" chip, which is what demonstrates to judges that both inputs mattered. The ledger is also the main input to the report.

### Guard rails enforced in the browser, not left to the prompt

- `probeAllowed` is computed client-side (Coach mode and cooldown elapsed, or wrap-up). A probe that comes back when it was not allowed is dropped.
- **Any** reply is dropped if the candidate spoke while the model was deciding (wrap-up excepted). Their new speech has already queued a fresh consult that sees everything.
- A `speech` consult only runs if there is speech the model has not seen yet, so mic noise cannot make the interviewer answer twice.
- Model calls time out after 15s; `speech` and `wrapup` consults retry once. If an answer to the interviewer's question still gets no reply, a fixed "say that again?" line is spoken.
- The code is only marked as "looked at" after a `code` consult or a spoken probe, so a passing remark does not use up new lines before they can be probed.
- After End, nothing can speak or consult (`endedRef`).
- A barge-in with no words following within 1.8s is treated as noise and the line is said again, once.
- Whatever the recognizer started hearing while the interviewer was speaking is discarded even after the mic reopens, except on a barge-in.
- Interview mode never sends `code` or `run` triggers at all.
- Mic results are discarded while the interviewer's audio is playing, plus 400ms, so it does not transcribe itself. A barge-in ends that immediately.

### Avatar states

`speaking` (audio playing) › `thinking` (LLM call in flight) › `listening` (interim speech results arriving) › `waiting` (everything else).

## Delivery metrics

Computed locally in [lib/metrics.ts](lib/metrics.ts), no LLM involved:

- **Words per minute** over actual speaking time (first interim result to final result per utterance).
- **Filler words**: count, rate per minute, and breakdown. List: um, uh, er, like, you know, basically, I mean, kind of, sort of, actually, literally.
- **Think-aloud coverage**: share of editor keystrokes that had speech within 6 seconds.
- **Longest silent coding stretch**: longest run of un-narrated edits with gaps under 15 seconds.

From Deepgram's word timings (hidden on the report when there are none: Chrome fallback, typed input, `/?demo`):

- **Mid-sentence pauses**: gaps of 1.5s or more between words inside one turn, and the longest.
- **Pace range**: slowest and fastest turn of 8 or more words, with when they happened.
- **Early versus late pace**: first half of the session against the second (needs 15 words in each).
- **Filler hotspot**: the 30s window with the most fillers, if 3 or more.

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
| [app/api/stt-token/route.ts](app/api/stt-token/route.ts) | Mints a 60s Deepgram token from `STT_API_KEY`; a non-200 response tells the client to use Chrome's recognizer |
| [app/api/tts/route.ts](app/api/tts/route.ts) | Proxies ElevenLabs; a non-200 response tells the client to use the browser voice |
| [lib/prompts.ts](lib/prompts.ts) | Interviewer system prompt (shared rules plus per-mode rules) and report prompt. **Most behavior tuning happens here.** |
| [lib/problem.ts](lib/problem.ts) | Two Sum: statement, starter code, tests, spoken intro, and interviewer-only notes (clarification answers, decisions worth explaining, edge cases) |
| [lib/types.ts](lib/types.ts) | Shared types: `TimelineEvent`, `Decision`, `InterviewerReply`, `Metrics`, `Report` |
| [lib/metrics.ts](lib/metrics.ts) | Delivery metrics |
| [lib/format.ts](lib/format.ts) | Turns the timeline into the transcript the LLM reads; numbers code lines |
| [lib/llm.ts](lib/llm.ts) | `chatJSON()`: one LLM call in JSON mode, with optional model override and fallback to the fast model |
| [hooks/useSpeechRecognition.ts](hooks/useSpeechRecognition.ts) | Deepgram Flux streaming speech-to-text: own echo-cancelled mic stream sent via `MediaRecorder` over a WebSocket, one `onFinal` per finished turn with word timings, reconnects on drop. Words spoken while muted are dropped by audio timestamp; `keepHeard()` keeps the last 1.5s on a barge-in. Returns `turns` (false on the Chrome fallback) |
| [hooks/useChromeSpeech.ts](hooks/useChromeSpeech.ts) | Fallback: continuous Chrome Web Speech API with auto-restart and muting |
| [hooks/useTTS.ts](hooks/useTTS.ts) | `speak(text, onStart)` streams and plays a line, resolving when it finishes, is stopped, or times out, and returns the audio blob URL for replay; `stop()` cuts it off; `preload(text)` fetches a clip; falls back to browser voice |
| [hooks/voiceActivity.ts](hooks/voiceActivity.ts) | Mic loudness watcher used for barge-in |
| [hooks/usePyodide.ts](hooks/usePyodide.ts) | Loads Pyodide and runs the code against the tests |

## Common changes

- **Interviewer too chatty, too quiet, or too generic:** edit [lib/prompts.ts](lib/prompts.ts). Avoid putting literal example sentences in the prompt; the model repeats them word for word. Describe the shape instead.
- **Timing of probes:** `SPEECH_SETTLE_MS`, `CODE_SETTLE_MS`, `PROBE_COOLDOWN_MS` in [app/page.tsx](app/page.tsx).
- **Interviewer cuts out when it shouldn't, or can't be interrupted:** `BARGE_RMS`, `BARGE_HOLD_MS`, `BARGE_GRACE_MS` in [app/page.tsx](app/page.tsx). Raise `BARGE_RMS` if it interrupts itself on speakers.
- **Too many or too few backchannels or thinking sounds:** the `BACKCHANNEL_*` and `THINKING_*` constants in the same place.
- **Turn detection too eager or too slow:** `eot_threshold` and `eot_timeout_ms` at the top of [hooks/useSpeechRecognition.ts](hooks/useSpeechRecognition.ts), and `TURN_SETTLE_MS` in [app/page.tsx](app/page.tsx).
- **Session length, time checks, check-ins:** `SESSION_MINUTES`, `TIME_CHECKS_MIN`, `CHECKIN_MS`, `INTERRUPT_*` in [app/page.tsx](app/page.tsx).
- **Different or additional problem:** add an object like the one in [lib/problem.ts](lib/problem.ts). The test harness in `usePyodide` assumes a `(nums, target)` signature and order-insensitive comparison, so it needs generalizing for other problems.
- **Different LLM:** change the three `LLM_*` variables. The provider must support `response_format: { type: "json_object" }`.

## Demo script

1. Start in Coach mode (pick a session length; 10 minutes is the default). The interviewer greets you, reads the problem and asks if you have questions.
2. Ask "can there be duplicates?" and get a direct answer.
3. Say "I'll use a hash map to store numbers as I go", then write the loop silently. A few seconds after you stop typing, the interviewer asks about lookup-before-insert, and the "Why I asked" chip shows the line and your quote.
4. Trail off mid-thought while typing: the interviewer stays silent. Finish a thought (a reason or a plan) and wait: it replies briefly.
5. Ask for a hint twice; the second is more specific.
6. Run tests, click "I'm done", answer the follow-up, answer the closing question, hear the sign-off, then "End & get report".
7. On the report, press Play on the replay, click a ⚑ moment, and "Redo this moment". Give a weak explanation first, then a good one, to show the grading change.
