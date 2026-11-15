import { BrandMark } from "./Brand";
import { ThemeToggle } from "./Theme";

// Top bar shared by the landing page and the dashboard. The interview room has its own.
export default function SiteNav({ current }: { current?: "dashboard" }) {
  return (
    <header className="topbar site">
      <BrandMark href="/" />
      <nav>
        <a href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>Dashboard</a>
        <a href="/interview?demo">Sample report</a>
      </nav>
      <span className="spacer" />
      <ThemeToggle />
      <a className="btn" href="/interview">Start an interview</a>
    </header>
  );
}
