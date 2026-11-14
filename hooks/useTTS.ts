"use client";
import { useCallback } from "react";

function browserSpeak(text: string) {
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// speak() resolves when the audio has finished playing. It returns a blob URL
// of the audio (kept for the replay), or null if the browser voice was used.
export function useTTS() {
  return useCallback(async (text: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status !== 200) throw new Error("no audio");
      const url = URL.createObjectURL(await res.blob());
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio playback failed"));
        audio.play().catch(reject);
      });
      return url;
    } catch {
      await browserSpeak(text);
      return null;
    }
  }, []);
}
