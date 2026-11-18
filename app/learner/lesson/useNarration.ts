"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const isSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-CA") ??
    voices.find((v) => v.lang.startsWith("en-") && /female|natural|google/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

/**
 * Slide narration with the browser's speechSynthesis (CLAUDE.md §3).
 * Text is always shown on screen as well, so nothing depends on sound.
 */
export function useNarration() {
  const supported = useSyncExternalStore(subscribe, isSupported, () => false);
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (!isSupported()) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!isSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-CA";
    u.rate = 0.95;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  // Never keep talking after the player is gone.
  useEffect(() => () => {
    if (isSupported()) window.speechSynthesis.cancel();
  }, []);

  return { supported, speaking, speak, stop };
}
