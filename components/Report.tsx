"use client";
import { useMemo, useState } from "react";
import { clock } from "@/lib/format";
import Replay, { snapshotAt, type Moment } from "./Replay";
import Redo from "./Redo";
import type {
  CodeSnapshot, Decision, Evidence, Metrics, Mode, RedoResult, RedoTarget, Report, RunResult, TimelineEvent,
} from "@/lib/types";

const NEARBY_MS = 30000; // how far around a moment to look for what was said

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

// Whether the candidate's pace changed between the two halves of the session.
function paceTrend(early: number, late: number) {
  if (late - early > 15) return "you sped up";
  if (early - late > 15) return "you slowed down";
  return "steady";
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
  timeline: TimelineEvent[];
  codeHistory: CodeSnapshot[];
  durationMs: number;
  audioUrl: string | null;
  audioOffsetMs: number;
}) {
  const { report, metrics: m, decisions, code, run, error, mode, timeline, codeHistory, durationMs } = props;
  const [seek, setSeek] = useState<{ t: number; n: number } | null>(null);
  const [target, setTarget] = useState<RedoTarget | null>(null);
  const [attempts, setAttempts] = useState<Record<string, RedoResult[]>>({});

  const saidNear = (t: number) =>
    timeline
      .filter((e) => e.type === "speech" && e.end >= t - NEARBY_MS && e.start <= t + NEARBY_MS)
      .map((e) => (e.type === "speech" ? e.text : ""))
      .join(" ");
  // When a line first appeared in full in the editor.
  const writtenAt = (quote: string) => {
    const q = quote.trim();
    return q ? codeHistory.find((s) => s.code.includes(q))?.t ?? null : null;
  };

  // One redo target per unexplained decision, placed at the moment its line was written.
  const targets = useMemo(() => {
    const out: Record<string, RedoTarget> = {};
    for (const d of decisions) {
      if (d.explained) continue;
      const t = writtenAt(d.code_quote) ?? durationMs;
      out[d.id] = {
        key: d.id,
        t,
        description: d.description,
        code_quote: d.code_quote,
        code: snapshotAt(codeHistory, t),
        firstSaid: saidNear(t) || d.said_quote,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions, codeHistory, timeline, durationMs]);

  const moments: Moment[] = Object.values(targets)
    .map((x) => ({ key: x.key, t: x.t, label: x.description }))
    .sort((a, b) => a.t - b.t);

  // "Redo from here": explain whatever was written in the 30s before the playhead.
  const redoAt = (t: number) => {
    const now = snapshotAt(codeHistory, t);
    const before = new Set(snapshotAt(codeHistory, t - NEARBY_MS).split("\n").map((l) => l.trim()));
    const added = now.split("\n").filter((l) => l.trim() && !before.has(l.trim()));
    setTarget({
      key: `at-${Math.round(t / 1000)}`,
      t,
      description: `What you were writing around ${clock(t)}, and why you wrote it that way`,
      code_quote: added.join("\n"),
      code: now,
      firstSaid: saidNear(t),
    });
  };

  // The report's missed explanation, matched to a decision when it quotes one.
  const missedQuote = report?.missed_explanation?.evidence;
  const missedKey =
    missedQuote?.source === "wrote"
      ? Object.values(targets).find((x) => x.code_quote.includes(missedQuote.quote.trim()) || missedQuote.quote.includes(x.code_quote.trim()))?.key
      : undefined;
  const redoMissed = () => {
    if (missedKey) return setTarget(targets[missedKey]);
    const t = (missedQuote?.source === "wrote" && writtenAt(missedQuote.quote)) || durationMs;
    setTarget({
      key: "missed",
      t,
      description: report!.missed_explanation.observation,
      code_quote: missedQuote?.source === "wrote" ? missedQuote.quote : "",
      code: snapshotAt(codeHistory, t),
      firstSaid: saidNear(t),
    });
  };

  const fixed = (id: string) => attempts[id]?.some((a) => a.explained);
  const explained = decisions.filter((d) => d.explained || fixed(d.id)).length;

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
              <button className="redo-btn" onClick={redoMissed}>↺ Redo this moment</button>
            </div>
            <div className="box retry">
              <h3>Try this next</h3>
              <p>{report.retry_exercise?.exercise}</p>
              <Quote ev={report.retry_exercise?.evidence} />
            </div>
          </div>

          </>
      )}

      <h2>Replay <span className="muted">— scrub through what you said and wrote, and redo the moments you skipped</span></h2>
      <Replay
        timeline={timeline}
        codeHistory={codeHistory}
        durationMs={durationMs}
        audioUrl={props.audioUrl}
        audioOffsetMs={props.audioOffsetMs}
        moments={moments}
        seek={seek}
        onRedoMoment={(key) => setTarget(targets[key])}
        onRedoAt={redoAt}
      />

      {report && (
        <>
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
      {m.midSentencePauses !== null && (
        <div className="stats" style={{ marginTop: 12 }}>
          <div>
            <b>{m.midSentencePauses}</b>
            <span>pauses of 1.5s+ mid-sentence{m.midSentencePauses > 0 && ` (longest ${m.longestPauseSeconds}s)`}</span>
          </div>
          {m.paceSlowest && m.paceFastest && (
            <div>
              <b>{m.paceSlowest.wpm}–{m.paceFastest.wpm}</b>
              <span>wpm range: slowest at {clock(m.paceSlowest.t)}, fastest at {clock(m.paceFastest.t)}</span>
            </div>
          )}
          {m.paceEarlyWpm !== null && m.paceLateWpm !== null && (
            <div>
              <b>{m.paceEarlyWpm} → {m.paceLateWpm}</b>
              <span>wpm, first half to second half ({paceTrend(m.paceEarlyWpm, m.paceLateWpm)})</span>
            </div>
          )}
          {m.fillerHotspot && (
            <div>
              <b>{m.fillerHotspot.count}</b>
              <span>fillers in 30s around {clock(m.fillerHotspot.t)}, your densest stretch</span>
            </div>
          )}
        </div>
      )}
      {report?.delivery && <p>{report.delivery}</p>}
      <p className="muted small">Counts "um" and "uh" as transcribed. If the session fell back to Chrome speech recognition, these are mostly dropped and the count is a lower bound.</p>

      <h2>Decisions in your code {decisions.length > 0 && <span className="muted">— {explained} of {decisions.length} explained out loud</span>}</h2>
      {decisions.length === 0 && <p className="muted">No decisions were recorded.</p>}
      <ul className="ledger">
        {decisions.map((d) => (
          <li key={d.id} className={d.explained || fixed(d.id) ? "pass" : "fail"}>
            <span className="mark">{d.explained || fixed(d.id) ? "✓" : "✗"}</span>
            <div>
              <div>{d.description} {d.code_quote && <code>{d.code_quote}</code>}</div>
              <div className="muted">
                {d.explained ? "Explained: " : d.said_quote ? "Closest you came: " : "Never mentioned"}
                {d.said_quote && <q>{d.said_quote}</q>}
              </div>
              {fixed(d.id) && <div className="pass small">Explained on your retake</div>}
              {targets[d.id] && (
                <div className="row">
                  <button className="link" onClick={() => setSeek({ t: targets[d.id].t - 3000, n: Date.now() })}>
                    Jump to {clock(targets[d.id].t)}
                  </button>
                  <button onClick={() => setTarget(targets[d.id])}>↺ {attempts[d.id] ? "Redo again" : "Redo this moment"}</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h2>Final code {run && <span className="muted">— {run.error ? "did not run" : `${run.passed}/${run.total} tests passed`}</span>}</h2>
      <pre className="code">{code}</pre>

      {target && (
        <Redo
          key={target.key}
          target={target}
          attempts={attempts[target.key] || []}
          onResult={(r) => setAttempts((a) => ({ ...a, [target.key]: [...(a[target.key] || []), r] }))}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
