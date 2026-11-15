# Open issues

Context for the design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Not yet tested

The API routes were tested with simulated requests against the real Gemini and ElevenLabs services and behaved as intended. Nothing below has been exercised in a real browser session:

1. **Microphone transcription.** Deepgram streaming was confirmed working in a browser by Andy on 2026-11-14 (on the earlier Nova-3 version). It has since been switched to Deepgram Flux (`/v2/listen`, turn events), which was only exercised from Node with a WebM file and token auth: Chrome's `MediaRecorder` into Flux, timestamp-based muting, barge-in, reconnect and the Chrome fallback still need a browser run. A key with the default role transcribes but cannot mint tokens (`FORBIDDEN`), which silently means Chrome; use a Member key.
2. **Audio playback** of the ElevenLabs voice in the page, and the browser-voice fallback.
3. **Echo suppression.** Mic results are dropped while the interviewer speaks plus 400ms. With speakers instead of headphones, the tail of the interviewer's voice may still land in the transcript as candidate speech.
4. **Pyodide runner** and the Run tests button.
5. **Camera box.**
6. **The trigger timing in practice**: whether 1.5s after speech and 4s after typing feel right, and whether the 25s probe cooldown is too long or short for a 3-minute demo.
7. **A full session through to the report** with real speech, including the metrics.

### Replay and redo (added later, also untested in a browser)

The `/api/redo` grader and the report on `gemini-3.8-flash` were tested with simulated requests. The UI below compiles but has not been seen running:

- **Replay timeline rendering and seeking**, including lane alignment and the playhead. `/interview?demo` loads a canned session to check this without a mic.
- **Session audio recording and synced playback.** Chrome reports recorded audio as endless until it is seeked once; there is a workaround in `Replay.tsx` that needs checking. Audio and the replay clock may drift on long sessions.
- **Mic recording alongside speech recognition.** Three things open the mic now (session recording, barge-in watcher, Deepgram stream); this normally works in Chrome but is unconfirmed here.
- **Interviewer lines replaying** at the right moments, and at 1.5× and 2×.
- **Redo recording**: the 45s countdown, and whether the last words arrive before grading (it waits 900ms after Stop).

### Live-conversation features (streaming voice, barge-in, backchannels; untested in a browser)

`/api/tts` streaming was measured from the terminal (first audio byte in about 0.35s). The rest needs ears:

- **Streamed playback through `MediaSource`** in `useTTS`, and that the saved blob still replays.
- **Barge-in threshold.** `BARGE_RMS = 0.045` is a guess. Too low and the interviewer pauses itself on speakers or on keyboard noise; too high and only the slower word signal interrupts. Tune with real hardware.
- **Barge-in rework (2026-11-14), untested in a browser.** Loudness now pauses the line and words confirm; recognised words alone also cut in (see ARCHITECTURE "Barge-in"). To check by ear: that talking over the interviewer stops it within about half a second; that a cough pauses for 1.2s and then resumes from the same spot (pause/resume of the streamed `MediaSource` audio); that "yeah"/"mhm" do not take the floor; on speakers, that the interviewer's own voice neither cuts it off nor lands in the transcript after a cut-in. A cut-in made only of words that also occur in the interviewer's line is not recognised as one. Pause/resume of the browser fallback voice is known to be flaky in Chrome.
- **A reply dropped because the candidate resumed talking while its audio loaded** still shows in the on-screen transcript and the report's transcript though it was never heard. The model is now told it was never spoken, and it no longer counts as a question asked or uses the probe cooldown; the "Why I asked" chip can still show for it.
- **Interviewer memory and "go on" after an interruption (2026-11-14).** Checked with simulated requests only (hand-written `heard` values): asked to continue, the interviewer says the unheard part instead of restarting. Not checked in a browser: whether `heard` lands near the real cut-off. It is an estimate (15 characters a second until the clip has fully downloaded, then a share of its length), and the word signal fires about half a second after the candidate starts, so it can run a few words long. Tune `CHARS_PER_SEC` in `hooks/useTTS.ts` if the interviewer skips or repeats words when it resumes. Before the prompt was tightened, one resumed probe gave away the answer to its own question, and a cut-off wrap-up question was skipped in favour of the closing question; neither recurred in two runs each after the fix, which is a small sample.
- **Resumed lines do not always keep their kind.** The model sometimes labels the finished question `other`; the browser treats a question right after a cut-off question as that question (`resuming` in `consult`). A statement that ends in a question mark in reply to a cut-in would be mislabelled the same way.
- **"Say that again?" comes back as `clarification`**, so the repeated question is no longer the latest question and the candidate's answer to it is not sent as `answering`. It usually still gets a reply through the hand-over rule.
- **Varied openers (2026-11-14).** In simulated runs no probe opened with the old template, and a second probe opened differently from the first. Seen instead: probes that go straight to the question without mentioning what the candidate said earlier (the quote still shows in the "Why I asked" chip), follow-ups that begin by saying the answer only described the code, and one probe that asked what a line stores rather than why. Listen for a new favourite opener over a full session.
- **Ledger sometimes comes back empty** on replies to a direct question or call talk (seen in simulation), which blanks the on-screen ledger until the next consult rebuilds it. Not confirmed whether this predates the prompt changes.
- **The prompt grew** by roughly 400 words for the speaking-style and cut-off sections. Simulated calls took 0.9 to 1.5s (1.9s with the second ask); watch latency by ear.
- **New backchannel clip "Got it."** has not been heard; drop it from `BACKCHANNELS` if it sounds like agreement.
- **Speech recognition accuracy** was the main remaining problem with Chrome. Switched to Deepgram (now the Flux model) with a keyterm list (`KEYTERMS` in `hooks/useSpeechRecognition.ts`); whether it actually does better on CS terms is not yet checked.
- **Barge-in on speakers.** The Deepgram stream now uses an echo-cancelled mic, and on a barge-in only the last 1.5s of muted audio is kept, so the interviewer's own words should rarely leak in. Still true on the Chrome fallback.
- **Backchannel timing and frequency**, and whether a backchannel on speakers gets transcribed as candidate speech.
- **Backchannel right before a spoken reply.** A thought that draws a probe can get "okay" and then the probe about a second later. May sound natural or may sound odd.
- **Taking the turn after a statement** (2026-11-14). Checked with simulated requests: a finished statement gets a short reply in both modes, narration while typing gets silence. It relies on a server-side second ask (see ARCHITECTURE "When the candidate hands over the floor"), which adds about a second in that case. Needs listening to: too chatty? too slow? In Interview mode the acknowledgement can lean towards agreement ("that makes sense").
- **End-of-turn detection** (Deepgram Flux, `eot_threshold` 0.75, `eot_timeout_ms` 4000, then `TURN_SETTLE_MS` 300). Untested on think-aloud speech: may end turns too early on a mid-thought pause or wait the full 4s on a trailing sentence.
- **New interviewer behaviours, all untested in a browser:** thinking sounds (how "Hmm." sounds, and that the reply follows cleanly), the backchannel after a silent reply, the session clock and lobby length buttons, time checks at 5 and 2 minutes left, time-up wrap-up, coach check-ins every 60s without contact, cutting in (5s wait, 2s barge-in grace), the closing question and sign-off.
- **Dead-end redirect names the problem too directly.** In simulation the coach said why the approach fails rather than only asking a question that exposes it. Prompt tuning in `lib/prompts.ts`.
- **Check-ins cost a model call a minute** in Coach mode while nothing else is happening.
- **Pace and pause tiles on the report** (math checked on synthetic timings; never seen rendered). The row holds one to four tiles and may look sparse.
- **Coach remarks are not rate-limited in the browser**; if it over-praises, add a guard or tighten the prompt.
- **Question detection** is a pattern match; it will miss some questions (they just get the normal 1.5s wait) and flag some statements.

### Added late on 2026-11-14 (built by agents; type-checks; none of it seen in a browser)

- **Said vs did** on the report. The route was called twice against the real report model: the demo session returned the planted "constant space" contradiction, a clean copy returned an empty list. Not seen: the box, its "Jump to" link, dark and mobile layouts. The `unkept` kind was never exercised. How often the model invents a mismatch is unknown (one call per case). A quote stitched across two speech events passes verification but gets no jump link; `did` is a substring match, so a partial line passes.
- **"Hear it"** on the redo card's strong answer: playback, the cache, Stop, and the browser-voice fallback. Cached blob URLs are never revoked (small leak per page load).
- **Dragging the replay playhead.** If the pointer is held still while playing, the playhead plays on away from it. Rapid seeks of the recorded mic audio may be choppy. A touch that starts on the track does not scroll the page.
- **Words kept when a line starts over an unfinished sentence** (`stt.flush()`, see ARCHITECTURE "Speaking over an unfinished sentence"). Reasoned through by reading only. Listen for: a redundant line from the interviewer right after a time check (a speech consult is queued behind it). Still lost: words during the 2s cut-in grace if the candidate then stops, and the last few hundred ms before the audio starts. Not covered on the Chrome fallback. The flushed speech event can carry a `t` slightly later than the line it sits before.
- **Problem picker, Valid Parentheses and Best Time to Buy and Sell Stock.** The harness's Python was run outside the browser with correct and wrong solutions for all three problems and behaved; one clarification per new problem was answered correctly by the live model. Not checked: the select in the lobby, the editor resetting on change, the generalised harness inside Pyodide, the spoken intros, probe quality and the report on the new problems. The harness is strict about booleans (`is_valid` returning 1 fails). The keyterm list grew by 11 and Deepgram's limit was not checked. The demo session and the dashboard's sample rows are Two Sum only; the landing page's code example is Two Sum. The late copy edits to the landing page, dashboard and footer have not been looked at.

- **Timeline at a glance** (headline meters, milestone chips, typing gradient, three-state pins, ≠ pins). Seen in headless-Chrome screenshots of `/interview?demo` in both themes; the report route returned sensible milestones twice for the demo session. Not exercised: dragging over the new pins, clicking a chip, a retake turning a pin green, the red "never mentioned" pin, a hit chip with no time, the chips' pending state. Pins close together overlap. A milestone time or ≠ pin needs the quote to sit inside one speech event. Changed after that screenshot and seen only in a second one: neutral capsule-shaped speaker lanes, no separate probe colour, the landing page's sample timeline redrawn to match. Not seen: a retake turning its row under the track green.

### Fixed after a code audit (2026-11-14), still to be confirmed by ear

These were found by reading the code after the live voice felt inconsistent, and are fixed in code:

- Interviewer replying twice to one utterance (a consult timer that re-armed on mic noise).
- Interviewer's own last words appearing as candidate speech right after it finished.
- Interviewer continuing to talk over the report page after End.
- Coach probes never arriving when the candidate said a word or two after writing code.
- Mic muted during the audio request, dropping words said in that gap.
- A stalled voice stream leaving the interviewer stuck on "Speaking" with the mic muted.
- A cough cutting the interviewer off and leaving silence (now: pause, then resume).
- No reply after the candidate answered a probe; now acknowledges or follows up.
- Transcript split into fragments at every small pause; now merged.
- Report page crashing when the model returned an object where text was expected; all model output is now coerced to the expected shape on the server.

### Branding (2026-11-14)

- **Name is a working name** ("TrojanPreps", in `lib/brand.ts`).
- **USC shield in the top bars** (`public/usc-shield.png`). Check USC's identity rules before a public launch. On the dark theme the cardinal lines sit on navy; only glanced at.
- **Colours settled:** indigo UI with cardinal and gold in the mesh (orb, washes). The orb's listening/thinking state colours hue-shift that mesh and have not been looked at live.

## Known problems

8. **Filler words were undercounted** with Chrome, which drops "um" and "uh". Deepgram is now asked to keep them (`filler_words=true`), so counts should be accurate unless the Chrome fallback is in use. The report's wording about undercounting may now be out of date; check after a real session.
9. **"like" and "actually" are counted as fillers even when used normally**, so the count can also be inflated for those words.
10. **An infinite loop in the candidate's code freezes the tab.** Pyodide runs on the main thread with no timeout. Fix: run it in a Web Worker and terminate on timeout.
11. **First hint gives away too much.** The level-1 nudge already mentions "data structure" and "constant time". Needs prompt tuning in `lib/prompts.ts`, or a stronger model.
12. **Lite model reliability.** `gemini-3.5-flash-lite` is fast (about 1s) but is the weak point for strict quoting and for judging "explained why" versus "said what". If probes turn generic or report quotes show "(paraphrased)", try the regular Flash model first.
13. **Switching mode mid-session** takes effect immediately but the ledger and hint level carry over. Not thought through; probably fine for a demo.
14. **Interview mode gets no feedback from Run.** The run result is logged and reaches the report, but the interviewer is not consulted. Intentional, but worth confirming.
15. **Pyodide loads twice in development** (React strict mode runs the effect twice). Harmless, wastes a download.
16. **No handling for a failed interviewer call** beyond a console error; the avatar just returns to Waiting.
17. **No mic-permission-denied message.** The typed fallback box still works, but nothing tells the user why the mic is silent.

- **The report is slower now.** About 9s on `gemini-3.8-flash`, versus about 2s on the lite model. Redo grading takes 4 to 6s.
- **Interviewer audio is missing from the replay when the browser voice was used** (no blob to replay), and the mic recording will contain the interviewer's voice if speakers were used, so it can play twice.
- **Redo targets depend on the ledger's `code_quote` matching the code exactly.** If the model's quote does not appear in any snapshot, the moment is placed at the end of the session.
- **Replay holds every keystroke's full code in memory.** Fine for a 10-minute session; not for long ones.
- **`/interview?demo` calls the report API on every load** (twice in development).

## Not built

18. **Three problems, one language.** Only Two Sum has been exercised properly. Tests must have JSON-representable arguments and results.
19. **No session persistence.** Refreshing the page loses the session and the report.
21. **No camera analysis.** Out of scope by design; the camera is only there to make it feel like a call.
22. **Design tradeoffs** are scored together with complexity, not as their own score.

## Setup notes

23. `npm audit` reported vulnerabilities in dependencies at install time; not looked into.
24. `.env.local` holds the keys and is gitignored. Each teammate needs their own, copied from `.env.example`.
