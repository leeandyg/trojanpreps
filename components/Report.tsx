"use client";
import type { Decision, Evidence, Metrics, Mode, Report, RunResult } from "@/lib/types";

const SCORE_LABELS: [keyof Report["scores"], string][] = [
  ["clarity", "Clarity of reasoning"],
  ["edge_cases", "Edge cases"],
  ["complexity_tradeoffs", "Complexity & tradeoffs"],
  ["correctness", "Correctness (code review)"],
];

function Quote({ ev }: { ev?: Evidence }) {
  if (!ev?.quote) return null;
  return (
    <div className="evidence">
      <span className="tag">{ev.source === "wrote" ? "You wrote" : "You said"}</span>
      {ev.source === "wrote" ? <code>{ev.quote}</code> : <q>{ev.quote}</q>}
      {ev.verified === false && <span className="muted"> (paraphrased)</span>}
    </div>
  );
}

function paceNote(wpm: number) {
  if (!wpm) return "not enough speech";
  if (wpm < 110) return "slow";
  if (wpm > 170) return "fast";
  return "comfortable";
}

export default function ReportView(props: {
  report: Report | null;
  metrics: Metrics;
  decisions: Decision[];
  code: string;
  run: RunResult | null;
  error: string;
  mode: Mode;
}) {
  const { report, metrics: m, decisions, code, run, error, mode } = props;
  const explained = decisions.filter((d) => d.explained).length;

  return (
    <div className="report">
      <header>
        <h1>Interview report</h1>
        <span className="muted">
          Two Sum · {mode === "coach" ? "Coach" : "Interview"} mode · {Math.floor(m.sessionSeconds / 60)}m {m.sessionSeconds % 60}s
        </span>
        <span className="spacer" />
        <button onClick={() => location.reload()}>Practice again</button>
      </header>

      {!report && !error && <p className="muted">Writing your feedback…</p>}
      {error && <p className="fail">Couldn't generate the written feedback: {error}</p>}

      {report && (
        <>
          <p className="summary">{report.summary}</p>

          <div className="three">
            <div className="box good">
              <h3>Strength</h3>
              <p>{report.strength?.observation}</p>
              <Quote ev={report.strength?.evidence} />
            </div>
            <div className="box miss">
              <h3>Missed explanation</h3>
              <p>{report.missed_explanation?.observation}</p>
              <Quote ev={report.missed_explanation?.evidence} />
            </div>
            <div className="box retry">
              <h3>Try this next</h3>
              <p>{report.retry_exercise?.exercise}</p>
              <Quote ev={report.retry_exercise?.evidence} />
            </div>
          </div>

          <h2>Scores</h2>
          <div className="scores">
            {SCORE_LABELS.map(([key, label]) => {
              const s = report.scores?.[key];
              if (!s) return null;
              return (
                <div key={key} className="score">
                  <div className="score-head">
                    <span>{label}</span>
                    <span className="pips">
                      {[1, 2, 3, 4].map((n) => <i key={n} className={n <= s.score ? "on" : ""} />)}
                      <b>{s.score}/4</b>
                    </span>
                  </div>
                  <p>{s.why}</p>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2>Delivery</h2>
      <div className="stats">
        <div><b>{m.wpm || "—"}</b><span>words per minute ({paceNote(m.wpm)})</span></div>
        <div>
          <b>{m.fillerCount}</b>
          <span>
            filler words{m.fillerBreakdown.length > 0 && `: ${m.fillerBreakdown.slice(0, 3).map((f) => `"${f.word}" ×${f.count}`).join(", ")}`}
          </span>
        </div>
        <div>
          <b>{m.thinkAloudCoverage === null ? "—" : `${Math.round(m.thinkAloudCoverage * 100)}%`}</b>
          <span>of your coding was narrated</span>
        </div>
        <div><b>{m.longestSilentCodingSeconds}s</b><span>longest silent coding stretch</span></div>
      </div>
      {report?.delivery && <p>{report.delivery}</p>}
      <p className="muted small">Speech recognition tends to drop "um" and "uh", so the filler count is a lower bound.</p>

      <h2>Decisions in your code {decisions.length > 0 && <span className="muted">— {explained} of {decisions.length} explained out loud</span>}</h2>
      {decisions.length === 0 && <p className="muted">No decisions were recorded.</p>}
      <ul className="ledger">
        {decisions.map((d) => (
          <li key={d.id} className={d.explained ? "pass" : "fail"}>
            <span className="mark">{d.explained ? "✓" : "✗"}</span>
            <div>
              <div>{d.description} {d.code_quote && <code>{d.code_quote}</code>}</div>
              <div className="muted">
                {d.explained ? "Explained: " : d.said_quote ? "Closest you came: " : "Never mentioned"}
                {d.said_quote && <q>{d.said_quote}</q>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h2>Final code {run && <span className="muted">— {run.error ? "did not run" : `${run.passed}/${run.total} tests passed`}</span>}</h2>
      <pre className="code">{code}</pre>
    </div>
  );
}
