"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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
/** `rate` comes from the pace table (§7.8): 0.9 slow, 1.0 medium, 1.05 fast. */
export function useNarration(rate = 1) {
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  const supported = useSyncExternalStore(subscribe, isSupported, () => false);
  const [speaking, setSpeaking] = useState(false);
  // Refs so the engagement tracker can read the latest values on every tick.
  const startedAtRef = useRef<number | null>(null);
  const speakingRef = useRef(false);

  const stop = useCallback(() => {
    if (!isSupported()) return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!isSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-CA";
    u.rate = rateRef.current;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onstart = () => {
      startedAtRef.current = Date.now();
      speakingRef.current = true;
      setSpeaking(true);
    };
    u.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    u.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };
    synth.speak(u);
  }, []);

  // Never keep talking after the player is gone.
  useEffect(() => () => {
    if (isSupported()) window.speechSynthesis.cancel();
  }, []);

  return { supported, speaking, speak, stop, startedAtRef, speakingRef };
}
