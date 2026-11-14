import { NextResponse } from "next/server";
import { chatJSON, REPORT_MODEL } from "@/lib/llm";
import { REPORT_SYSTEM } from "@/lib/prompts";
import { formatTimeline, numberLines } from "@/lib/format";
import type { Evidence, Report, TimelineEvent } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function POST(req: Request) {
  const { mode, code, timeline, run, decisions, metrics } = await req.json();

  const user = `MODE: ${mode}

TRANSCRIPT
${formatTimeline(timeline)}

FINAL CODE
${numberLines(code)}

TEST RESULTS
${run ? JSON.stringify(run) : "(the candidate never ran the code; review it by reading)"}

DECISION LEDGER
${JSON.stringify(decisions)}

DELIVERY METRICS
${JSON.stringify(metrics)}`;

  try {
    const report = await chatJSON<Report>(REPORT_SYSTEM, user, 0.2, REPORT_MODEL);

    // Check each quote really appears in what was said or written.
    const said = norm(
      (timeline as TimelineEvent[]).filter((e) => e.type === "speech").map((e) => e.text).join(" ")
    );
    const wrote = norm(code);
    const check = (ev?: Evidence) => {
      if (!ev?.quote) return;
      const q = norm(ev.quote);
      ev.verified = q.length > 0 && (said.includes(q) || wrote.includes(q));
    };
    check(report.strength?.evidence);
    check(report.missed_explanation?.evidence);
    check(report.retry_exercise?.evidence);

    return NextResponse.json(report);
  } catch (e: any) {
    console.error("report error", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
