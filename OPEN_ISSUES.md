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

- **Replay timeline rendering and seeking**, including lane alignment and the playhead. `/?demo` loads a canned session to check this without a mic.
- **Session audio recording and synced playback.** Chrome reports recorded audio as endless until it is seeked once; there is a workaround in `Replay.tsx` that needs checking. Audio and the replay clock may drift on long sessions.
- **Mic recording alongside speech recognition.** Three things open the mic now (session recording, barge-in watcher, Deepgram stream); this normally works in Chrome but is unconfirmed here.
- **Interviewer lines replaying** at the right moments, and at 1.5× and 2×.
- **Redo recording**: the 45s countdown, and whether the last words arrive before grading (it waits 900ms after Stop).

### Live-conversation features (streaming voice, barge-in, backchannels; untested in a browser)

`/api/tts` streaming was measured from the terminal (first audio byte in about 0.35s). The rest needs ears:

- **Streamed playback through `MediaSource`** in `useTTS`, and that the saved blob still replays.
- **Barge-in threshold.** `BARGE_RMS = 0.045` is a guess. Too low and the interviewer cuts itself off on speakers or on keyboard noise; too high and you have to shout. Tune with real hardware.
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

### Fixed after a code audit (2026-11-14), still to be confirmed by ear

These were found by reading the code after the live voice felt inconsistent, and are fixed in code:

- Interviewer replying twice to one utterance (a consult timer that re-armed on mic noise).
- Interviewer's own last words appearing as candidate speech right after it finished.
- Interviewer continuing to talk over the report page after End.
- Coach probes never arriving when the candidate said a word or two after writing code.
- Mic muted during the audio request, dropping words said in that gap.
- A stalled voice stream leaving the interviewer stuck on "Speaking" with the mic muted.
- A cough cutting the interviewer off and leaving silence.
- No reply after the candidate answered a probe; now acknowledges or follows up.
- Transcript split into fragments at every small pause; now merged.
- Report page crashing when the model returned an object where text was expected; all model output is now coerced to the expected shape on the server.

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
- **`/?demo` calls the report API on every load** (twice in development).

## Not built

18. **Only one problem and one language.** The test harness assumes Two Sum's signature (see "Common changes" in the architecture doc).
19. **No session persistence.** Refreshing the page loses the session and the report.
21. **No camera analysis.** Out of scope by design; the camera is only there to make it feel like a call.
22. **Design tradeoffs** are scored together with complexity, not as their own score.

## Setup notes

23. `npm audit` reported vulnerabilities in dependencies at install time; not looked into.
24. `.env.local` holds the keys and is gitignored. Each teammate needs their own, copied from `.env.example`.
