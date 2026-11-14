# Open issues

Context for the design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Not yet tested

The API routes were tested with simulated requests against the real Gemini and ElevenLabs services and behaved as intended. Nothing below has been exercised in a real browser session:

1. **Microphone transcription** end to end (Chrome Web Speech API, auto-restart, utterance timing).
2. **Audio playback** of the ElevenLabs voice in the page, and the browser-voice fallback.
3. **Echo suppression.** Mic results are dropped while the interviewer speaks plus 400ms. With speakers instead of headphones, the tail of the interviewer's voice may still land in the transcript as candidate speech.
4. **Pyodide runner** and the Run tests button.
5. **Camera box.**
6. **The trigger timing in practice**: whether 1.5s after speech and 4s after typing feel right, and whether the 25s probe cooldown is too long or short for a 3-minute demo.
7. **A full session through to the report** with real speech, including the metrics.

## Known problems

8. **Filler words are undercounted.** Chrome's recognizer usually drops "um" and "uh". The report states this. Possible fix: record the mic and re-transcribe at the end with a model prompted to keep disfluencies.
9. **"like" and "actually" are counted as fillers even when used normally**, so the count can also be inflated for those words.
10. **An infinite loop in the candidate's code freezes the tab.** Pyodide runs on the main thread with no timeout. Fix: run it in a Web Worker and terminate on timeout.
11. **First hint gives away too much.** The level-1 nudge already mentions "data structure" and "constant time". Needs prompt tuning in `lib/prompts.ts`, or a stronger model.
12. **Lite model reliability.** `gemini-3.5-flash-lite` is fast (about 1s) but is the weak point for strict quoting and for judging "explained why" versus "said what". If probes turn generic or report quotes show "(paraphrased)", try the regular Flash model first.
13. **Switching mode mid-session** takes effect immediately but the ledger and hint level carry over. Not thought through; probably fine for a demo.
14. **Interview mode gets no feedback from Run.** The run result is logged and reaches the report, but the interviewer is not consulted. Intentional, but worth confirming.
15. **Pyodide loads twice in development** (React strict mode runs the effect twice). Harmless, wastes a download.
16. **No handling for a failed interviewer call** beyond a console error; the avatar just returns to Waiting.
17. **No mic-permission-denied message.** The typed fallback box still works, but nothing tells the user why the mic is silent.

## Not built

18. **Only one problem and one language.** The test harness assumes Two Sum's signature (see "Common changes" in the architecture doc).
19. **No session persistence.** Refreshing the page loses the session and the report.
20. **Report does not show the transcript timeline** (when the silent stretches happened). The data is there in the timeline.
21. **No camera analysis.** Out of scope by design; the camera is only there to make it feel like a call.
22. **Design tradeoffs** are scored together with complexity, not as their own score.

## Setup notes

23. `npm audit` reported vulnerabilities in dependencies at install time; not looked into.
24. `.env.local` holds the keys and is gitignored. Each teammate needs their own, copied from `.env.example`.
