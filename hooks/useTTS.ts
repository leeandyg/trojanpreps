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

// speak() resolves when the audio has finished playing.
export function useTTS() {
  return useCallback(async (text: string) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status !== 200) return browserSpeak(text);
      const url = URL.createObjectURL(await res.blob());
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio playback failed"));
        audio.play().catch(reject);
      });
      URL.revokeObjectURL(url);
    } catch {
      await browserSpeak(text);
    }
  }, []);
}
