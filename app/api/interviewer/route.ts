import { NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { interviewerSystem } from "@/lib/prompts";
import { formatTimeline, numberLines } from "@/lib/format";
import type { InterviewerReply } from "@/lib/types";

export async function POST(req: Request) {
  const { mode, trigger, code, timeline, run, decisions, hintLevel, probeAllowed } = await req.json();

  const user = `TRIGGER: ${trigger}
probe_allowed: ${probeAllowed}
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
      action: reply.action === "speak" && reply.say ? "speak" : "stay_silent",
      kind: reply.kind || "other",
      say: reply.say || "",
      grounding: reply.grounding,
      decisions: Array.isArray(reply.decisions) ? reply.decisions : decisions,
      hint_level: typeof reply.hint_level === "number" ? reply.hint_level : hintLevel,
    });
  } catch (e: any) {
    console.error("interviewer error", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
