import { NextResponse } from "next/server";
import { chatJSON, REPORT_MODEL } from "@/lib/llm";
import { REPORT_SYSTEM } from "@/lib/prompts";
import { formatTimeline, numberLines } from "@/lib/format";
import type { Evidence, Report, TimelineEvent } from "@/lib/types";

// The model sometimes returns an object or list where a sentence was asked for.
// Flatten anything like that to plain text so the page can always render it.
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? Object.values(v).map(text).filter(Boolean).join(" ") : String(v);

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
    const raw = await chatJSON<any>(REPORT_SYSTEM, user, 0.2, REPORT_MODEL);
    const evidence = (e: any) => ({ source: e?.source === "wrote" ? "wrote" : "said", quote: text(e?.quote) }) as Evidence;
    const score = (s: any) => ({ score: Math.min(4, Math.max(1, Math.round(Number(s?.score) || 1))), why: text(s?.why) });
    const report: Report = {
      summary: text(raw.summary),
      delivery: text(raw.delivery),
      scores: {
        correctness: score(raw.scores?.correctness),
        edge_cases: score(raw.scores?.edge_cases),
        complexity_tradeoffs: score(raw.scores?.complexity_tradeoffs),
        clarity: score(raw.scores?.clarity),
      },
      strength: { observation: text(raw.strength?.observation), evidence: evidence(raw.strength?.evidence) },
      missed_explanation: {
        observation: text(raw.missed_explanation?.observation),
        evidence: evidence(raw.missed_explanation?.evidence),
      },
      retry_exercise: { exercise: text(raw.retry_exercise?.exercise), evidence: evidence(raw.retry_exercise?.evidence) },
    };

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
