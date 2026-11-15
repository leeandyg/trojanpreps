# Agent rules

## What this is

An **MVP** of a voice-driven mock technical interview web app, built for the AI@USC hackathon. The candidate talks through a coding problem while an AI interviewer hears them, watches the live editor, asks grounded follow-ups, and writes an end report.

- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing behavior. Check [OPEN_ISSUES.md](OPEN_ISSUES.md) for known gaps before "fixing" something that is already known.
- Scope is deliberately small: one problem (Two Sum), one language (Python), two modes (Interview, Coach), Chrome only.
- Routes: `/` is a static landing page, `/dashboard` a static dashboard with sample data (other interview types are "Coming soon" placeholders), and `/interview` is the actual app. Only `/interview` does anything.

## Team

- **Two developers**, both working on `main` in https://github.com/leeandyg/ai-usc-hackathon. No PR process.
- The other dev may have pushed since you last looked. Run `git pull` before starting work, and pull again before pushing.
- Keep commits small and focused so the other dev can follow and merge easily. Do not rewrite shared history (no force-push to `main`).
- The committed docs are how the two devs stay in sync. Anything the other dev needs to know goes in them, not only in chat.
- Each dev keeps their own `.env.local` (copied from `.env.example`) and may keep a personal `HANDOFF.md`. Both are gitignored, so the other dev cannot see them.

## Priorities

1. **The demo works.** The demo script at the end of ARCHITECTURE.md must keep working end to end. Do not break it.
2. **Simple over complete.** Prefer the smallest change that solves the problem. No new abstractions, frameworks, or config layers "for later".
3. **Hackathon code.** No tests, no hardening, no auth, no database. Do not add them unless asked.

## Rules

- **Stay in scope.** Do not add problems, languages, persistence, or features beyond the request. Suggest them instead.
- **Ask before adding dependencies.** Current stack: Next.js (fonts via the built-in `next/font/google`), React, Monaco, `openai` SDK, Pyodide (CDN), Deepgram (raw WebSocket, no SDK). Anything new needs a reason.
- **Keys stay on the server.** All LLM and TTS calls go through `app/api/*`. Never read `LLM_*`, `TTS_*` or `STT_*` env vars in client code. Never commit `.env.local`.
- **Server is stateless.** The browser holds session state and sends it on every call. Keep it that way.
- **Guard rails live in the browser** (`probeAllowed`, dropping stale probes, mic muting). Do not move them into the prompt.
- **Interviewer behavior is tuned in [lib/prompts.ts](lib/prompts.ts).** Describe the shape of a good reply; do not put literal example sentences in prompts, the model repeats them.
- **Styling is plain CSS in [app/globals.css](app/globals.css)** with colour tokens for light (default) and dark. Use the tokens, not hard-coded colours. Name, tagline, interviewer name and logo path live in [lib/brand.ts](lib/brand.ts).
- **Timing constants** live at the top of [app/interview/page.tsx](app/interview/page.tsx). Change them there, not inline.
- **Shared types** go in [lib/types.ts](lib/types.ts). Keep the LLM reply shape and the types in sync.
- **Match existing style.** Small files, plain functions and hooks, light comments.

## Before you finish

- Run `npx tsc --noEmit` (and `npm run build` for larger changes). Report failures honestly.
- Browser-only features (mic, audio, Pyodide, camera) cannot be verified from the terminal. Say so instead of claiming they work.

## Keep the docs current

Update the docs after every change and at the end of every session, in the same commit as the code where possible. Stale docs mislead the other dev.

- **[ARCHITECTURE.md](ARCHITECTURE.md):** any change to behavior, flow, triggers, timing values, env vars, the file map, or the demo script.
- **[OPEN_ISSUES.md](OPEN_ISSUES.md):** add problems you find or leave behind. Remove or mark items you fix. Move items out of "Not yet tested" once they have actually been checked in a browser.
- **AGENTS.md (this file):** changes to stack, rules, scope, or team workflow.
- **HANDOFF.md** (local, if present): at the end of a session, refresh state, what was verified, and next steps.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
