"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Push-to-talk speech recognition (CLAUDE.md §3, §7.5). Only text is kept;
 * audio stays in the browser and is never stored or sent by our code.
 * Not available on every browser (e.g. iOS Safari): callers show a text box.
 */

// Minimal types: the Web Speech API is not in TypeScript's DOM lib.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribe = () => () => {};

export type ListenError = "denied" | "no_speech" | "failed" | null;

export function useSpeechRecognition() {
  const supported = useSyncExternalStore(subscribe, () => ctor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<ListenError>(null);
  const recRef = useRef<Recognition | null>(null);

  const discardRef = useRef(false);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  /** Stops listening and throws away anything heard (e.g. the learner typed instead). */
  const cancel = useCallback(() => {
    if (!recRef.current) return;
    discardRef.current = true;
    recRef.current.abort();
  }, []);

  /** Starts listening; `onFinal` gets the full transcript when the learner stops talking. */
  const start = useCallback((onFinal: (text: string) => void) => {
    const Ctor = ctor();
    if (!Ctor) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = "en-CA";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim((finalText + live).trim());
    };
    rec.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "no_speech" : "failed");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalText.trim();
      const discard = discardRef.current;
      discardRef.current = false;
      if (text && !discard) onFinal(text);
    };
    recRef.current = rec;
    setError(null);
    setInterim("");
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError("failed");
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, cancel };
}
