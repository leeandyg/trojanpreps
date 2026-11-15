"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChromeSpeech, type SpeechHandlers } from "./useChromeSpeech";

// Words Deepgram should favor (keyterm prompting).
const KEYTERMS = [
  "Tommy", // the interviewer's name
  // the problem
  "Two Sum", "nums", "target", "indices", "index", "pair", "complement", "duplicates", "negative numbers", "edge case",
  // data structures and Python
  "hash map", "hashmap", "hash table", "dictionary", "dict", "set", "array", "list", "tuple", "key", "value",
  "Python", "enumerate", "range", "len", "return", "for loop", "nested loop", "lookup",
  // approaches and complexity
  "brute force", "one pass", "two pass", "two pointers", "sort", "sorted", "optimize",
  "time complexity", "space complexity", "Big O", "O of n", "O of n squared", "O of 1", "constant time", "linear time", "quadratic",
];
// Flux: a model that also judges when the speaker has finished their turn. It keeps
// "um"/"uh", punctuates, and gives per-word timings without extra options.
const params = new URLSearchParams({
  model: "flux-general-en",
  eot_threshold: "0.75", // how sure it must be that the turn is over (default 0.7)
  eot_timeout_ms: "4000", // silence that ends a turn regardless, e.g. after trailing off
});
KEYTERMS.forEach((k) => params.append("keyterm", k));
const URL_ = `wss://api.deepgram.com/v2/listen?${params}`;
const CHUNK_MS = 100; // how often mic audio is sent, and how often mute state is sampled
const KEEP_ON_BARGE_S = 1.5; // on a barge-in, keep words from this far back

type Word = { word: string; start: number; end: number }; // word carries its punctuation; times are seconds into the stream

// Continuous speech-to-text via Deepgram Flux streaming. `onFinal` fires once per turn,
// when Flux judges the candidate has finished speaking (not at every small pause), with
// per-word timings. Words spoken while `mutedRef` is true (the interviewer's voice is
// playing) are dropped by their audio timestamps, so the interviewer's own words never
// land in the transcript. Falls back to Chrome's recognizer if there is no Deepgram key
// or the connection fails; `turns` tells the caller which one is in use.
export function useSpeechRecognition(handlers: SpeechHandlers, mutedRef: React.RefObject<boolean>) {
  const chrome = useChromeSpeech(handlers, mutedRef);
  const { start: chromeStart, stop: chromeStop, keepHeard: chromeKeepHeard } = chrome;
  const [fallback, setFallback] = useState(false);
  const [interim, setInterim] = useState("");
  const [blocked, setBlocked] = useState(false);
  const h = useRef(handlers);
  h.current = handlers;
  const activeRef = useRef(false);
  const fallbackRef = useRef(false);
  const closeRef = useRef<(() => void) | null>(null);
  const flushRef = useRef<(() => void) | null>(null); // delivers the turn in progress
  const t0Ref = useRef(0); // Date.now() when audio started flowing; Deepgram times are seconds since then
  const cutoffRef = useRef(0); // words starting before this (audio seconds) were heard while muted
  const muteFromRef = useRef(0); // cutoff before the current mute began

  const connect = useCallback(
    async function connect() {
      const useChrome = () => {
        console.warn("Deepgram unavailable, using Chrome speech recognition");
        fallbackRef.current = true;
        setFallback(true);
        chromeStart();
      };
      let token: string | undefined;
      try {
        const res = await fetch("/api/stt-token", { method: "POST" });
        if (res.status === 200) token = (await res.json()).token;
      } catch {}
      if (!activeRef.current) return;
      if (!token) return useChrome();

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        activeRef.current = false;
        setBlocked(true);
        return;
      }
      if (!activeRef.current) return stream.getTracks().forEach((t) => t.stop());

      const ws = new WebSocket(URL_, ["bearer", token]);
      const rec = new MediaRecorder(stream);
      let opened = false;
      let wasMuted = false;
      let turn: Word[] = []; // kept words of the turn in progress
      let heard = ""; // their text, to notice when something new arrives
      const flush = () => {
        const t0 = t0Ref.current;
        if (turn.length && activeRef.current) {
          h.current.onFinal(heard, t0 + turn[0].start * 1000, t0 + turn[turn.length - 1].end * 1000, {
            words: turn.map((w) => ({ w: w.word, s: t0 + w.start * 1000, e: t0 + w.end * 1000 })),
            endOfTurn: true,
          });
        }
        turn = [];
        heard = "";
        setInterim("");
      };

      ws.onopen = () => {
        opened = true;
        rec.ondataavailable = (e) => {
          const at = (Date.now() - t0Ref.current) / 1000;
          if (mutedRef.current) {
            if (!wasMuted) muteFromRef.current = cutoffRef.current;
            cutoffRef.current = at;
          }
          wasMuted = !!mutedRef.current;
          if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        t0Ref.current = Date.now();
        cutoffRef.current = muteFromRef.current = 0;
        rec.start(CHUNK_MS);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === "Error") return console.warn("deepgram error", msg);
        if (msg.type !== "TurnInfo") return;
        // Every message carries all the words of the current turn so far.
        // While the interviewer is speaking, pass them up: the candidate may be cutting in.
        if (mutedRef.current && msg.words?.length) {
          const t0 = t0Ref.current;
          h.current.onOverlap?.(msg.words.map((w: Word) => ({ w: w.word, s: t0 + w.start * 1000 })));
        }
        turn = (msg.words ?? []).filter((w: Word) => w.start >= cutoffRef.current);
        const text = turn.map((w) => w.word).join(" ");
        // Updates keep coming during silence with the same words; only new words are activity.
        if (text && text !== heard) h.current.onActivity(text);
        heard = text;
        if (msg.event === "EndOfTurn") return flush();
        setInterim(text);
      };
      ws.onerror = () => console.warn("deepgram socket error");
      ws.onclose = (e) => {
        if (rec.state !== "inactive") rec.stop();
        stream.getTracks().forEach((t) => t.stop());
        flush(); // a dropped connection must not lose the turn in progress
        if (flushRef.current === flush) flushRef.current = null;
        if (!activeRef.current) return;
        if (!opened) return useChrome(); // bad token or blocked socket: don't loop
        console.warn("deepgram closed, reconnecting", e.code, e.reason);
        setTimeout(() => activeRef.current && connect(), 1000);
      };
      closeRef.current = () => ws.close();
      flushRef.current = flush;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutedRef]
  );

  // Check up front whether Deepgram is usable, so a fallback to Chrome starts
  // inside the Start click like it always did, not after a network round trip.
  useEffect(() => {
    fetch("/api/stt-token", { method: "POST" })
      .then((res) => res.status === 200)
      .catch(() => false)
      .then((ok) => {
        if (ok || activeRef.current) return;
        console.warn("Deepgram unavailable (check STT_API_KEY and its role), using Chrome speech recognition");
        fallbackRef.current = true;
        setFallback(true);
      });
  }, []);

  useEffect(
    () => () => {
      activeRef.current = false;
      closeRef.current?.();
    },
    []
  );

  const start = useCallback(() => {
    if (fallbackRef.current) return chromeStart();
    if (activeRef.current) return;
    activeRef.current = true;
    connect();
  }, [chromeStart, connect]);
  const stop = useCallback(() => {
    flushRef.current?.(); // words said just before Stop have not reached an end of turn yet
    flushRef.current = null;
    activeRef.current = false;
    closeRef.current?.();
    closeRef.current = null;
    setInterim("");
    if (fallbackRef.current) chromeStop();
  }, [chromeStop]);
  // Call when unmuting because the candidate cut in: keep what they said just before.
  // `from` (a Date.now() value) is where their words began, when that is known.
  const keepHeard = useCallback(
    (from?: number) => {
      const at = (Date.now() - t0Ref.current) / 1000;
      const since = from === undefined ? at - KEEP_ON_BARGE_S : (from - t0Ref.current) / 1000;
      cutoffRef.current = Math.max(muteFromRef.current, since);
      chromeKeepHeard();
    },
    [chromeKeepHeard]
  );

  // `turns`: onFinal means a finished turn (Deepgram), not just a pause (Chrome).
  if (fallback) return { ...chrome, turns: false, start, stop, keepHeard };
  return { interim, supported: true, blocked, turns: true, start, stop, keepHeard };
}
