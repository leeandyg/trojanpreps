"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpokenWord } from "@/lib/types";

export type SpeechHandlers = {
  // start/end are Date.now() values for when the utterance began and finished
  // `info` is only given by Deepgram: per-word timings (Date.now() values), and endOfTurn = the
  // recognizer itself judged the candidate finished their turn (no extra silence wait needed).
  onFinal: (text: string, start: number, end: number, info?: { words: SpokenWord[]; endOfTurn: boolean }) => void;
  // Fires whenever the candidate is heard, before any onFinal from the same event. `text` is what was heard.
  onActivity: (text: string) => void;
  // Words recognised while muted, i.e. while the interviewer's voice is playing (`s` is a Date.now()
  // value). They may be the candidate cutting in, or the interviewer's own voice from the speakers.
  onOverlap?: (words: { w: string; s: number }[]) => void;
};

// Fallback speech-to-text (Chrome Web Speech API), used when Deepgram is unavailable.
// Continuous Chrome speech-to-text. While `mutedRef` is true (the interviewer's
// voice is playing) results are ignored, and anything the recognizer started
// hearing during that time stays ignored until it finishes, so the interviewer's
// own words never land in the transcript a moment after it stops talking.
export function useChromeSpeech(handlers: SpeechHandlers, mutedRef: React.RefObject<boolean>) {
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
        const over: { w: string; s: number }[] = [];
        for (let i = e.resultIndex; i < e.results.length; i++) {
          taintedRef.current.add(i);
          for (const w of e.results[i][0].transcript.trim().split(/\s+/)) if (w) over.push({ w, s: Date.now() });
        }
        if (over.length) h.current.onOverlap?.(over);
        if (!mutedRef.current) return; // that was the candidate cutting in: the caller unmuted and kept it
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
      h.current.onActivity(heard.map((r) => r.text).join(" "));
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
