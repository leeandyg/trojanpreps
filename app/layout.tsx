import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `${BRAND.name} · ${BRAND.tagline}` };

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

// Runs before first paint so a saved dark theme does not flash light. Key matches THEME_KEY in components/Theme.tsx.
const themeScript = `try{if(localStorage.getItem("mock-interview-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
