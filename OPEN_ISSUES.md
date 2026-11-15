# Status and known limitations

Context for the design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

Tested end to end in Chrome on 2026-11-15, on headphones and on speakers, with the full stack (Deepgram Flux speech-to-text, ElevenLabs voice, Gemini interviewer and report):

- **Voice conversation:** transcription, turn-taking, talking over Tommy (barge-in and resume), probes grounded in code and speech, hints in Coach mode, time checks, the closing question.
- **Code:** the Monaco editor and running the tests in Pyodide.
- **Report:** feedback, said vs did, scores and delivery metrics; the replay timeline and scrubbing; Redo this moment and Hear it.

The production deployment (https://trojanpreps.vercel.app) serves all pages and API routes.

### Next to check

- **Valid Parentheses and Best Time to Buy and Sell Stock** in a full browser session. Two Sum is the problem that has been tested in full; the test harness for the other two was checked outside the browser with correct and wrong solutions, and the live model answers their clarifying questions correctly.

## Known limitations

Deliberate scope for the MVP, or edges worth knowing about:

1. **Chrome only.** Other browsers are not supported.
2. **Sessions are not saved.** Refreshing loses the session and its report; the dashboard's history rows are sample data.
3. **An infinite loop in the candidate's code freezes the tab.** Pyodide runs on the main thread with no timeout. Fix: run it in a Web Worker and terminate on timeout.
4. **The live interviewer uses a fast, lite model** (`gemini-3.5-flash-lite`, about 1s per reply). It can occasionally be lenient about "explained why" versus "said what". Setting `LLM_MODEL` to a stronger model trades latency for judgement.
5. **The report takes about 9s** on `gemini-3.8-flash`; redo grading takes 4 to 6s.
6. **Filler-word counts are approximate.** "like" and "actually" count even when used normally, and if Deepgram is unavailable the Chrome fallback drops "um" and "uh" (the report says so).
7. **Replay edges.** Interviewer audio is missing from the replay when the browser voice was used, and a redo moment whose code quote matches no snapshot is placed at the end of the session.
8. **Test harness:** arguments and results must be JSON-representable, and booleans are strict (`is_valid` returning `1` fails).

## Ideas for later

- Save sessions, so the dashboard shows real history and progress.
- The other interview types shown as "Coming soon" on the dashboard (system design, behavioral, code review, SQL).
- More problems and languages.
- Pyodide in a Web Worker with a timeout (limitation 3).
- Design tradeoffs as their own score, separate from complexity.
- An extension question after a solve (a changed constraint).

Camera analysis is out of scope by design: the camera is there to make it feel like a call.

## Setup notes

- Each teammate keeps their own `.env.local`, copied from `.env.example`. Production env vars live in the Vercel project (see ARCHITECTURE "Deployed").
- `npm audit` flags DOMPurify, pulled in by the Monaco editor. The affected modes are not used for untrusted input here; left as is on purpose before the demo. `npm audit fix` resolves it without breaking changes.
