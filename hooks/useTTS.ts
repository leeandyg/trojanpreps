"use client";
import { useMemo, useRef } from "react";

const MP3 = "audio/mpeg";

// Fetches a line of interviewer audio. Returns null when there is no premium
// voice (TTS_PROVIDER=browser, or the provider failed).
async function fetchAudio(text: string) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return res.status === 200 && res.body ? res : null;
}

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const finishRef = useRef<(() => void) | null>(null); // resolves the current speak()

  return useMemo(() => {
    // Cuts off whatever is being said. The pending speak() resolves right away.
    const stop = () => {
      audioRef.current?.pause();
      speechSynthesis.cancel();
      finishRef.current?.();
    };

    // Plays `text` and resolves when it finishes or is stopped. Audio starts as
    // soon as the first bytes arrive rather than after the whole clip downloads.
    // Returns a blob URL of the audio for the replay, or null for the browser voice.
    const speak = async (text: string): Promise<string | null> => {
      stop();
      let stopped = false;
      const done = new Promise<void>((resolve) => {
        finishRef.current = () => {
          stopped = true;
          resolve();
        };
      });

      try {
        const res = await fetchAudio(text);
        if (stopped) return null; // cut off before any audio arrived
        if (!res) throw new Error("no audio");
        const audio = new Audio();
        audioRef.current = audio;
        audio.onended = () => finishRef.current?.();
        audio.onerror = () => finishRef.current?.();
        const chunks: BlobPart[] = [];

        if (window.MediaSource && MediaSource.isTypeSupported(MP3)) {
          const source = new MediaSource();
          audio.src = URL.createObjectURL(source);
          await new Promise((r) => source.addEventListener("sourceopen", r, { once: true }));
          const buffer = source.addSourceBuffer(MP3);
          audio.play().catch(() => finishRef.current?.());
          const reader = res.body!.getReader();
          while (!stopped) {
            const { done: end, value } = await reader.read();
            if (end) break;
            chunks.push(value);
            buffer.appendBuffer(value);
            await new Promise((r) => buffer.addEventListener("updateend", r, { once: true }));
          }
          if (stopped) reader.cancel().catch(() => {});
          else if (source.readyState === "open") source.endOfStream();
        } else {
          chunks.push(await res.blob());
          audio.src = URL.createObjectURL(new Blob(chunks, { type: MP3 }));
          audio.play().catch(() => finishRef.current?.());
        }
        await done;
        return URL.createObjectURL(new Blob(chunks, { type: MP3 }));
      } catch {
        if (stopped) return null;
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.onend = u.onerror = () => finishRef.current?.();
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
