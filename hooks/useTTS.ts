"use client";
import { useMemo, useRef } from "react";

const MP3 = "audio/mpeg";
const FETCH_TIMEOUT_MS = 20000;

// Fetches a line of interviewer audio. Returns null when there is no premium
// voice (TTS_PROVIDER=browser, or the provider failed).
async function fetchAudio(text: string) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res.status === 200 && res.body ? res : null;
}

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null); // held so Chrome doesn't drop it mid-speech
  const finishRef = useRef<(() => void) | null>(null); // ends the line currently being spoken

  return useMemo(() => {
    // Cuts off whatever is being said. The pending speak() resolves right away.
    const stop = () => {
      audioRef.current?.pause();
      speechSynthesis.cancel();
      finishRef.current?.();
    };

    // Plays `text` and resolves when it finishes or is stopped; it can never hang.
    // Audio starts as soon as the first bytes arrive. `onStart` fires when sound
    // actually begins. Returns a blob URL of the audio for the replay, or null.
    const speak = async (text: string, onStart?: () => void): Promise<string | null> => {
      stop();
      let over = false; // finished, stopped, or timed out
      let started = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      const finish = () => {
        if (over) return;
        over = true;
        clearTimeout(watchdog);
        reader?.cancel().catch(() => {});
        resolve();
      };
      finishRef.current = finish;
      // If neither "ended" nor an error ever arrives, give up after a generous estimate of the line's length.
      const watchdog = setTimeout(() => {
        audioRef.current?.pause();
        speechSynthesis.cancel();
        finish();
      }, text.length * 90 + 8000);
      const begin = () => {
        if (started || over) return;
        started = true;
        onStart?.();
      };

      try {
        const res = await fetchAudio(text);
        if (over) return null; // cut off before any audio arrived
        if (!res) throw new Error("no audio");
        const audio = new Audio();
        audioRef.current = audio;
        audio.onplaying = begin;
        audio.onended = finish;
        audio.onerror = finish;
        const chunks: BlobPart[] = [];

        if (window.MediaSource && MediaSource.isTypeSupported(MP3)) {
          const source = new MediaSource();
          audio.src = URL.createObjectURL(source);
          await new Promise((r) => source.addEventListener("sourceopen", r, { once: true }));
          const buffer = source.addSourceBuffer(MP3);
          audio.play().catch(finish);
          reader = res.body!.getReader();
          while (!over) {
            const { done: end, value } = await reader.read();
            if (end || !value) break;
            chunks.push(value as BlobPart);
            buffer.appendBuffer(value as BufferSource);
            await new Promise((r) => buffer.addEventListener("updateend", r, { once: true }));
          }
          if (!over && source.readyState === "open") source.endOfStream();
        } else {
          chunks.push(await res.blob());
          audio.src = URL.createObjectURL(new Blob(chunks, { type: MP3 }));
          audio.play().catch(finish);
        }
        await done;
        return chunks.length ? URL.createObjectURL(new Blob(chunks, { type: MP3 })) : null;
      } catch {
        if (over) return null;
        if (started) {
          // The stream broke after sound began. Don't say the whole line again in another voice.
          audioRef.current?.pause();
          finish();
          return null;
        }
        const u = new SpeechSynthesisUtterance(text);
        utterRef.current = u;
        u.rate = 1.05;
        u.onstart = begin;
        u.onend = u.onerror = finish;
        speechSynthesis.speak(u);
        await done;
        return null;
      }
    };

    // Downloads a short clip up front (for backchannels). Null if no premium voice.
    const preload = async (text: string) => {
      try {
        const res = await fetchAudio(text);
        return res ? URL.createObjectURL(await res.blob()) : null;
      } catch {
        return null;
      }
    };

    return { speak, stop, preload };
  }, []);
}
