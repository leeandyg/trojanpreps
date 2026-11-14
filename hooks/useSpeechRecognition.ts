"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Handlers = {
  // start/end are Date.now() values for when the utterance began and finished
  onFinal: (text: string, start: number, end: number) => void;
  onActivity: () => void; // fires on every interim result
};

// Continuous Chrome speech-to-text. `mutedRef` drops results while the
// interviewer's voice is playing so it doesn't transcribe itself.
export function useSpeechRecognition(handlers: Handlers, mutedRef: React.RefObject<boolean>) {
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);
  const activeRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      if (mutedRef.current) {
        startRef.current = null;
        setInterim("");
        return;
      }
      h.current.onActivity();
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        if (startRef.current === null) startRef.current = Date.now();
        if (e.results[i].isFinal) {
          h.current.onFinal(text, startRef.current, Date.now());
          startRef.current = null;
        } else pending += text + " ";
      }
      setInterim(pending.trim());
    };
    rec.onend = () => {
      if (activeRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };
    rec.onerror = (e: any) => console.warn("speech recognition:", e.error);
    recRef.current = rec;
    return () => {
      activeRef.current = false;
      rec.abort();
    };
  }, [mutedRef]);

  const start = useCallback(() => {
    activeRef.current = true;
    try {
      recRef.current?.start();
    } catch {}
  }, []);
  const stop = useCallback(() => {
    activeRef.current = false;
    recRef.current?.stop();
    setInterim("");
  }, []);

  return { interim, supported, start, stop };
}
