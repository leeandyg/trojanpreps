import { BRAND } from "@/lib/brand";

// The USC shield and the product name, for the left end of a top bar.
export function BrandMark({ href }: { href?: string }) {
  const inner = (
    <>
      <img src={BRAND.uscLogo} alt="USC" />
      {BRAND.name}
    </>
  );
  return <strong className="brand">{href ? <a href={href}>{inner}</a> : inner}</strong>;
}

// The tagline as a small chip. Used once, in the landing hero.
export function Tagline() {
  return <span className="tagline">{BRAND.tagline}</span>;
}

// Footer shared by the landing page and the dashboard.
export function SiteFoot() {
  return (
    <footer className="foot">
      <div className="wrap">
        {BRAND.name}: {BRAND.tagline.toLowerCase()}. Built at the AI@USC hackathon. One problem (Two Sum) in Python for now.
      </div>
    </footer>
  );
}
