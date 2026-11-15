import SiteNav from "@/components/SiteNav";
import { SiteFoot, Tagline } from "@/components/Brand";

// Marketing page. Static: the hero shows one real interviewer question from a test run.
const CODE = [
  "def two_sum(nums, target):",
  "    seen = {}",
  "    for i, n in enumerate(nums):",
  "        if target - n in seen:",
  "            return [seen[target - n], i]",
  "        seen[n] = i",
];
const QUOTED = [4, 6]; // the lines the question is about

// Replay lanes drawn with the same classes as components/Replay.tsx. Positions are illustrative.
const YOU = [[2, 14], [19, 9], [41, 7], [62, 16], [84, 10]];
const AI = [[0, 2, ""], [16, 3, ""], [50, 5, "probe"], [79, 4, ""], [95, 4, "wrapup"]] as const;
const TYPING = [[22, 26], [56, 20]];
const SILENT = [30, 11];

const pct = (n: number) => `${n}%`;

export default function Landing() {
  return (
    <>
      <SiteNav />

      <section className="hero">
        <div className="wrap">
          <div>
            <Tagline />
            <h1>Practice explaining your code out loud.</h1>
            <p>
              Solving the problem is the part you already practice. This is a voice interview room for the other part:
              saying why, while an interviewer listens to you and watches your editor.
            </p>
            <div className="cta">
              <a className="btn primary" href="/interview">Start a mock interview</a>
              <a className="btn" href="/dashboard">Open the dashboard</a>
            </div>
            <p className="muted">Free, no sign-up. Needs Chrome and a microphone.</p>
          </div>

          <div className="moment-card" aria-label="An example of a question the interviewer asked">
            <div className="avatar speaking">
              <div className="orb" />
              <div>
                <div className="who">Tommy · your interviewer</div>
                <div className="state">Speaking</div>
              </div>
            </div>
            <pre className="code">
              {CODE.map((line, i) => (
                <div key={i} className={QUOTED.includes(i + 1) ? "hl" : ""}>
                  <span className="ln">{i + 1}</span>{line}
                </div>
              ))}
            </pre>
            <p className="asked">
              <q>
                Why do you check for the complement on line four before adding the current number to the dictionary?
              </q>
            </p>
            <div className="why">
              <div className="why-title">Why it asked</div>
              <div>Your code: <code>if target - n in seen:</code></div>
              <div>You said: <q>I&apos;ll store the numbers as I go</q></div>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>An interviewer that follows both your voice and your code</h2>
          <p className="lede">
            A chatbot can ask you interview questions. It cannot notice that what you just typed does not match what
            you said a minute ago.
          </p>
          <dl className="terms">
            <div>
              <dt>Follow-ups come from your own work</dt>
              <dd>
                The interviewer hears you and sees the live editor, so its questions point at a line you wrote and a
                thing you said. The question above is from a real test run.
              </dd>
            </div>
            <div>
              <dt>It stays quiet while you think</dt>
              <dd>
                Thinking aloud and pauses get no response. You can talk over it and it stops, the way a person would.
              </dd>
            </div>
            <div>
              <dt>Two ways to practice</dt>
              <dd>
                Interview mode answers clarifying questions and gives no hints. Coach mode asks about decisions you
                did not explain and gives a small hint when you ask for one.
              </dd>
            </div>
            <div>
              <dt>The report quotes you</dt>
              <dd>
                Feedback cites what you actually said and wrote, and measures delivery: pace, filler words, and how
                much of your coding you narrated.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>Replay the session and redo the moments you skipped</h2>
          <p className="lede">
            Every session becomes a timeline of when you talked, when you typed, and where you typed in silence. Pick
            a flagged moment, explain it again, and get the retake graded against your first attempt.
          </p>
          <div className="replay" role="img" aria-label="Illustration of a replay timeline with lanes for you, the interviewer and typing">
            <div className="track">
              <div className="lane">
                <span className="lane-name">You</span>
                {YOU.map(([l, w], i) => <i key={i} className="seg you" style={{ left: pct(l), width: pct(w) }} />)}
              </div>
              <div className="lane">
                <span className="lane-name">Tommy</span>
                {AI.map(([l, w, kind], i) => <i key={i} className={`seg ai ${kind}`} style={{ left: pct(l), width: pct(w) }} />)}
              </div>
              <div className="lane">
                <span className="lane-name">Typing</span>
                {TYPING.map(([l, w], i) => <i key={i} className="seg typing" style={{ left: pct(l), width: pct(w) }} />)}
                <i className="seg silent" style={{ left: pct(SILENT[0]), width: pct(SILENT[1]) }} />
              </div>
              <b className="pin flag" style={{ left: pct(35) }}>⚑</b>
            </div>
            <div className="legend muted small">
              <span><i className="seg you" /> you talking</span>
              <span><i className="seg ai" /> Tommy</span>
              <span><i className="seg ai probe" /> probe</span>
              <span><i className="seg typing" /> typing</span>
              <span><i className="seg silent" /> typing in silence</span>
              <span><b className="flag">⚑</b> unexplained decision</span>
            </div>
          </div>
          <p className="muted small">Illustration. <a href="/interview?demo">Open a sample report</a> to try the real replay.</p>
        </div>
      </section>

      <section className="closing">
        <div className="wrap">
          <h2>Ten minutes, one problem, out loud.</h2>
          <div className="cta">
            <a className="btn primary" href="/interview">Start a mock interview</a>
            <a className="btn" href="/interview?demo">See a sample report</a>
          </div>
        </div>
      </section>

      <SiteFoot />
    </>
  );
}
