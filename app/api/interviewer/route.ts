import { NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { interviewerSystem } from "@/lib/prompts";
import { clock, formatTimeline, numberLines } from "@/lib/format";
import type { InterviewerReply } from "@/lib/types";

export async function POST(req: Request) {
  const { mode, trigger, code, timeline, run, decisions, hintLevel, probeAllowed, answering, followupsLeft, secondsSinceEdit, minutesLeft, stage, elapsedMs } = await req.json();

  const user = `TRIGGER: ${trigger}
probe_allowed: ${probeAllowed}
answering: ${!!answering}
followups_left: ${followupsLeft ?? 0}
hint_level: ${hintLevel}
seconds_since_last_edit: ${secondsSinceEdit ?? "unknown"}
minutes_left: ${minutesLeft ?? "unknown"}
stage: ${stage ?? "working"}
now: ${typeof elapsedMs === "number" ? clock(elapsedMs) : "unknown"}

EDITOR
${numberLines(code)}

LATEST RUN
${run ? JSON.stringify(run) : "(not run yet)"}

TRANSCRIPT SO FAR
${formatTimeline(timeline)}

CURRENT LEDGER
${JSON.stringify(decisions)}`;

  try {
    let reply = await chatJSON<InterviewerReply>(interviewerSystem(mode), user);
    // The fast model often reads the turn correctly ("handed_over") and then says nothing anyway.
    // When its own reading says the candidate is waiting, ask once more for the words.
    const turn = (reply as any).turn;
    const silent = typeof reply.say !== "string" || !reply.say.trim();
    if (trigger === "speech" && silent && (turn === "handed_over" || turn === "question")) {
      const nudge = `\n\nYou classified the candidate's latest speech as "${turn}" but left "say" empty. They have stopped and are waiting for you. Return the full JSON again with "say" filled in, following the rules for replying to "${turn}".`;
      reply = await chatJSON<InterviewerReply>(interviewerSystem(mode), user + nudge).catch(() => reply);
    }
    return NextResponse.json({
      action: typeof reply.say === "string" && reply.say.trim() ? "speak" : "stay_silent", // the model speaks by filling "say"
      kind: reply.kind || "other",
      turn: (reply as any).turn, // the model's own reading, passed through for debugging
      stuck: (reply as any).stuck === true,
      say: typeof reply.say === "string" ? reply.say : "",
      // keep every ledger field a plain string so the UI can always render it
      decisions: Array.isArray(reply.decisions)
        ? reply.decisions.map((d: any, i: number) => ({
            id: String(d?.id ?? `d${i + 1}`),
            description: String(d?.description ?? ""),
            code_quote: String(d?.code_quote ?? ""),
            explained: d?.explained === true,
            said_quote: String(d?.said_quote ?? ""),
          }))
        : decisions,
      grounding: reply.grounding
        ? { code_quote: String(reply.grounding.code_quote ?? ""), said_quote: String(reply.grounding.said_quote ?? "") }
        : undefined,
      hint_level: typeof reply.hint_level === "number" ? reply.hint_level : hintLevel,
    });
  } catch (e: any) {
    console.error("interviewer error", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
