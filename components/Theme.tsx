"use client";
import { useSyncExternalStore } from "react";
import Editor, { type EditorProps } from "@monaco-editor/react";

export type Theme = "light" | "dark";

// The theme lives on <html data-theme>. app/layout.tsx sets it before first paint from this key.
export const THEME_KEY = "mock-interview-theme";

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "light");
}

function toggleTheme() {
  const next: Theme = read() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
}

// Both icons are always rendered; globals.css shows the right one, so there is nothing to mismatch on hydration.
export function ThemeToggle() {
  return (
    <button className="theme-toggle" onClick={toggleTheme} aria-label="Switch between light and dark" title="Switch between light and dark">
      <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}

// Monaco with themes that follow the app theme and sit flush on the panel colour (--panel in globals.css).
export function CodeEditor(props: EditorProps) {
  const theme = useTheme();
  return <Editor {...props} theme={theme === "dark" ? "room-dark" : "room-light"} beforeMount={defineEditorThemes} />;
}

function defineEditorThemes(monaco: any) {
  monaco.editor.defineTheme("room-light", {
    base: "vs", inherit: true, rules: [],
    colors: { "editor.background": "#ffffff", "editor.lineHighlightBackground": "#f3f5fb", "editorLineNumber.foreground": "#a3aec4", "editorLineNumber.activeForeground": "#5546f2" },
  });
  monaco.editor.defineTheme("room-dark", {
    base: "vs-dark", inherit: true, rules: [],
    colors: { "editor.background": "#0e1430", "editor.lineHighlightBackground": "#151c3f", "editorLineNumber.foreground": "#4a557f", "editorLineNumber.activeForeground": "#b3acff" },
  });
}
