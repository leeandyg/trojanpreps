import SiteNav from "@/components/SiteNav";
import { SiteFoot } from "@/components/Brand";

// Signed-in home. Nothing here is stored or fetched: only the technical interview works,
// and the history rows are sample content.
const COMING_SOON = [
  { title: "System design", blurb: "Sketch an architecture and defend the trade-offs as the requirements change." },
  { title: "Behavioral", blurb: "Tell a story about past work and get pushed on the parts you glossed over." },
  { title: "Code review", blurb: "Read someone else's pull request aloud and say what you would change, and why." },
  { title: "SQL and data", blurb: "Write a query against a small schema while explaining your joins and edge cases." },
];

const SAMPLE_SESSIONS = [
  { when: "Nov 12", mode: "Coach", length: "10 min", narrated: "78%", explained: "4 of 5", wpm: 152 },
  { when: "Nov 9", mode: "Interview", length: "10 min", narrated: "64%", explained: "3 of 5", wpm: 161 },
  { when: "Nov 5", mode: "Coach", length: "5 min", narrated: "49%", explained: "2 of 4", wpm: 173 },
];

export default function Dashboard() {
  return (
    <>
      <SiteNav current="dashboard" />
      <main className="wrap dash">
        <h1>What do you want to practice?</h1>
        <p>Pick an interview type. Each session ends with a report, a replay, and the moments worth redoing.</p>

        <div className="types">
          <a className="type open" href="/interview" style={{ textDecoration: "none", color: "inherit" }}>
            <div>
              <span className="chip ok">Available</span>
              <h3>Technical interview</h3>
              <p>
                Solve a coding problem while you talk it through. The interviewer hears you, watches your editor and
                asks about the decisions you did not explain.
              </p>
              <div className="facts">
                <span className="chip">3 problems</span>
                <span className="chip">Python</span>
                <span className="chip">5, 10 or 20 min</span>
                <span className="chip">Interview or Coach mode</span>
              </div>
            </div>
            <span className="btn primary">Start interview</span>
          </a>

          {COMING_SOON.map((t) => (
            <div key={t.title} className="type off" aria-disabled="true">
              <span className="chip">Coming soon</span>
              <h3>{t.title}</h3>
              <p>{t.blurb}</p>
            </div>
          ))}
        </div>

        <h2>Recent sessions <span className="chip">Sample data</span></h2>
        <p>
          Sessions are not saved yet, so these rows are examples, not your results. <a href="/interview?demo">Open the sample report</a> to
          see what one looks like.
        </p>
        <div className="table-scroll">
          <table className="sessions">
            <thead>
              <tr>
                <th>Session</th>
                <th>Mode</th>
                <th>Length</th>
                <th className="num">Coding narrated</th>
                <th className="num">Decisions explained</th>
                <th className="num">Words per minute</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_SESSIONS.map((s) => (
                <tr key={s.when}>
                  <td>Two Sum, {s.when}</td>
                  <td>{s.mode}</td>
                  <td>{s.length}</td>
                  <td className="num">{s.narrated}</td>
                  <td className="num">{s.explained}</td>
                  <td className="num">{s.wpm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <SiteFoot />
    </>
  );
}
