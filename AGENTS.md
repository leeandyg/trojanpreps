# Agent rules

## What this is

An **MVP** of a voice-driven mock technical interview web app, built for the AI@USC hackathon. The candidate talks through a coding problem while an AI interviewer hears them, watches the live editor, asks grounded follow-ups, and writes an end report.

- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing behavior. Check [OPEN_ISSUES.md](OPEN_ISSUES.md) for known gaps before "fixing" something that is already known.
- Scope is deliberately small: one problem (Two Sum), one language (Python), two modes (Interview, Coach), Chrome only.

## Priorities

1. **The demo works.** The demo script at the end of ARCHITECTURE.md must keep working end to end. Do not break it.
2. **Simple over complete.** Prefer the smallest change that solves the problem. No new abstractions, frameworks, or config layers "for later".
3. **Hackathon code.** No tests, no hardening, no auth, no database. Do not add them unless asked.

## Rules

- **Stay in scope.** Do not add problems, languages, persistence, or features beyond the request. Suggest them instead.
- **Ask before adding dependencies.** Current stack: Next.js, React, Monaco, `openai` SDK, Pyodide (CDN). Anything new needs a reason.
- **Keys stay on the server.** All LLM and TTS calls go through `app/api/*`. Never read `LLM_*` or `TTS_*` env vars in client code. Never commit `.env.local`.
- **Server is stateless.** The browser holds session state and sends it on every call. Keep it that way.
- **Guard rails live in the browser** (`probeAllowed`, dropping stale probes, mic muting). Do not move them into the prompt.
- **Interviewer behavior is tuned in [lib/prompts.ts](lib/prompts.ts).** Describe the shape of a good reply; do not put literal example sentences in prompts, the model repeats them.
- **Timing constants** live at the top of [app/page.tsx](app/page.tsx). Change them there, not inline.
- **Shared types** go in [lib/types.ts](lib/types.ts). Keep the LLM reply shape and the types in sync.
- **Match existing style.** Small files, plain functions and hooks, light comments.

## Before you finish

- Run `npx tsc --noEmit` (and `npm run build` for larger changes). Report failures honestly.
- Browser-only features (mic, audio, Pyodide, camera) cannot be verified from the terminal. Say so instead of claiming they work.
- If you change how something works, update ARCHITECTURE.md. If you find or leave a known problem, add it to OPEN_ISSUES.md.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
