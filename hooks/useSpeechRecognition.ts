"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Handlers = {
  // start/end are Date.now() values for when the utterance began and finished
  onFinal: (text: string, start: number, end: number) => void;
  onActivity: () => void; // fires whenever the candidate is heard, before any onFinal from the same event
};

// Continuous Chrome speech-to-text. While `mutedRef` is true (the interviewer's
// voice is playing) results are ignored, and anything the recognizer started
// hearing during that time stays ignored until it finishes, so the interviewer's
// own words never land in the transcript a moment after it stops talking.
export function useSpeechRecognition(handlers: Handlers, mutedRef: React.RefObject<boolean>) {
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(true);
  const [blocked, setBlocked] = useState(false); // mic permission denied
  const recRef = useRef<any>(null);
  const activeRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const taintedRef = useRef(new Set<number>()); // result indexes first heard while muted
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
        for (let i = e.resultIndex; i < e.results.length; i++) taintedRef.current.add(i);
        startRef.current = null;
        setInterim("");
        return;
      }
      const heard: { text: string; final: boolean }[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (taintedRef.current.has(i)) continue;
        const text = e.results[i][0].transcript.trim();
        if (text) heard.push({ text, final: e.results[i].isFinal });
      }
      if (!heard.length) return;
      h.current.onActivity();
      let pending = "";
      for (const r of heard) {
        if (startRef.current === null) startRef.current = Date.now();
        if (r.final) {
          h.current.onFinal(r.text, startRef.current, Date.now());
          startRef.current = null;
        } else pending += r.text + " ";
      }
      setInterim(pending.trim());
    };
    rec.onend = () => {
      // Chrome ends a continuous session by itself now and then; result indexes start over.
      taintedRef.current.clear();
      startRef.current = null;
      setInterim("");
      if (activeRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        activeRef.current = false; // don't loop on a denied permission
        setBlocked(true);
      } else if (e.error !== "no-speech" && e.error !== "aborted") console.warn("speech recognition:", e.error);
    };
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
  // Call when unmuting because the candidate cut in: what was heard during the
  // mute is their speech, so keep it instead of discarding it.
  const keepHeard = useCallback(() => taintedRef.current.clear(), []);

  return { interim, supported, blocked, start, stop, keepHeard };
}
