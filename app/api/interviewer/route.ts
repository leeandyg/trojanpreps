import { NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { interviewerSystem } from "@/lib/prompts";
import { formatTimeline, numberLines } from "@/lib/format";
import type { InterviewerReply } from "@/lib/types";

export async function POST(req: Request) {
  const { mode, trigger, code, timeline, run, decisions, hintLevel, probeAllowed, answering, followupsLeft } = await req.json();

  const user = `TRIGGER: ${trigger}
probe_allowed: ${probeAllowed}
answering: ${!!answering}
followups_left: ${followupsLeft ?? 0}
hint_level: ${hintLevel}

EDITOR
${numberLines(code)}

LATEST RUN
${run ? JSON.stringify(run) : "(not run yet)"}

TRANSCRIPT SO FAR
${formatTimeline(timeline)}

CURRENT LEDGER
${JSON.stringify(decisions)}`;

  try {
    const reply = await chatJSON<InterviewerReply>(interviewerSystem(mode), user);
    return NextResponse.json({
      action: reply.action === "speak" && typeof reply.say === "string" && reply.say.trim() ? "speak" : "stay_silent",
      kind: reply.kind || "other",
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
