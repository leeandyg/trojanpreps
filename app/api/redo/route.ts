import { NextResponse } from "next/server";
import { chatJSON, REPORT_MODEL } from "@/lib/llm";
import { REDO_SYSTEM } from "@/lib/prompts";
import { numberLines } from "@/lib/format";

// Grades a re-recorded explanation of one moment against the first attempt.
export async function POST(req: Request) {
  const { description, code_quote, code, firstSaid, retake } = await req.json();

  const user = `ASKED TO EXPLAIN
${description}

CODE IT CONCERNS
${code_quote || "(the code as a whole)"}

EDITOR AT THAT MOMENT
${numberLines(code)}

WHAT THEY SAID THE FIRST TIME
${firstSaid || "(nothing)"}

RETAKE
${retake || "(nothing was said)"}`;

  try {
    const r = await chatJSON<any>(REDO_SYSTEM, user, 0.2, REPORT_MODEL);
    const text = (v: unknown): string =>
      v == null ? "" : typeof v === "object" ? Object.values(v).map(text).filter(Boolean).join(" ") : String(v);
    return NextResponse.json({
      explained: r.explained === true,
      score: Math.min(4, Math.max(1, Math.round(Number(r.score) || 1))),
      verdict: text(r.verdict),
      improved: text(r.improved),
      still_missing: text(r.still_missing),
      model_answer: text(r.model_answer),
    });
  } catch (e: any) {
    console.error("redo error", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
