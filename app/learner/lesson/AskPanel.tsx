"use client";

import { useId, useRef, useState } from "react";
import { learnerMessages } from "@/lib/i18n";
import type { AskResponse } from "@/app/api/ask/route";
import { useSpeechRecognition } from "./useSpeechRecognition";

const t = learnerMessages.lesson.ask;

type Turn = { question: string; answer: string };
type State =
  | { phase: "closed" }
  | { phase: "open"; note: string | null }
  | { phase: "sending"; question: string }
  | {
      phase: "answered";
      question: string;
      answer: string;
      checkQuestion: string;
      questionId: string | null;
      rated: boolean | null;
    };

type Props = {
  lessonId: string;
  slideNo: number;
  aiReady: boolean;
  /** Pause: stop narration immediately (position is the current slide). */
  onPause: () => void;
  /** Resume the lesson where it stopped. */
  onResume: () => void;
  /** Speak a text aloud (answers are read out as well as shown). */
  speak: (text: string) => void;
  onSafety: (message: string) => void;
};

/** Push-to-talk question box (CLAUDE.md §7.2). Typed questions always work too. */
export function AskPanel({ lessonId, slideNo, aiReady, onPause, onResume, speak, onSafety }: Props) {
  const id = useId();
  const [state, setState] = useState<State>({ phase: "closed" });
  const [typed, setTyped] = useState("");
  const history = useRef<Turn[]>([]);
  const mic = useSpeechRecognition();

  /** "Was this helpful?" Saved as questions.helpful; the UI thanks the learner either way. */
  async function rate(questionId: string, helpful: boolean) {
    setState((s) => (s.phase === "answered" ? { ...s, rated: helpful } : s));
    await fetch("/api/ask/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, helpful }),
    }).catch(() => {});
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q) return;
    // A typed question while the mic is open: stop listening and drop the half-heard text.
    if (mic.listening) mic.cancel();
    setState({ phase: "sending", question: q });
    let res: AskResponse;
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId, slideNo, question: q, history: history.current.slice(-3) }),
      });
      res = (await r.json()) as AskResponse;
    } catch {
      res = { ok: false, code: "unavailable" };
    }
    if (res.ok && res.kind === "safety") {
      onSafety(res.message);
      return;
    }
    if (res.ok) {
      history.current = [...history.current, { question: q, answer: res.answer }].slice(-3);
      setTyped("");
      setState({ phase: "answered", question: q, answer: res.answer, checkQuestion: res.checkQuestion, questionId: res.questionId, rated: null });
      speak(res.checkQuestion ? `${res.answer} ${res.checkQuestion}` : res.answer);
      return;
    }
    const note = res.code === "ai_not_connected" ? t.notConnected : res.code === "rate_limited" ? t.rateLimited : t.unavailable;
    setState({ phase: "open", note });
  }

  function openAndListen() {
    onPause();
    if (!aiReady) {
      setState({ phase: "open", note: t.notConnected });
      return;
    }
    if (!mic.supported) {
      setState({ phase: "open", note: t.micUnsupported });
      return;
    }
    setState({ phase: "open", note: null });
    mic.start((text) => void send(text));
  }

  function resume() {
    mic.stop();
    setState({ phase: "closed" });
    onResume();
  }

  const micNote = mic.error === "denied" ? t.micDenied : mic.error === "no_speech" ? t.noSpeech : mic.error ? t.micUnsupported : null;

  if (state.phase === "closed") {
    return (
      <button
        type="button"
        onClick={openAndListen}
        className="flex min-h-11 items-center gap-2 self-start rounded-full border-2 border-blue-700 px-5 font-semibold text-blue-800 dark:text-blue-200"
      >
        <MicIcon /> {t.button}
      </button>
    );
  }

  return (
    <section aria-label={t.button} className="flex flex-col gap-3 rounded-xl border-2 border-blue-700 bg-blue-50 p-4 text-blue-950 dark:bg-blue-950 dark:text-blue-50" data-testid="ask-panel">
      <div aria-live="polite" className="flex flex-col gap-2">
        {mic.listening && state.phase === "open" && (
          <p className="font-semibold">
            {t.listening} {mic.interim && <span className="font-normal">“{mic.interim}”</span>}
          </p>
        )}
        {state.phase === "open" && (state.note || micNote) && <p data-testid="ask-note">{state.note ?? micNote}</p>}
        {state.phase === "sending" && (
          <>
            <p>
              <strong>{t.yourQuestion}:</strong> {state.question}
            </p>
            <p>{t.sending}</p>
          </>
        )}
        {state.phase === "answered" && (
          <>
            <p>
              <strong>{t.yourQuestion}:</strong> {state.question}
            </p>
            <p className="text-xl" data-testid="ask-answer">
              {state.answer}
            </p>
            {state.checkQuestion && (
              <p className="font-semibold" data-testid="ask-check">
                {state.checkQuestion}
              </p>
            )}
            {state.questionId && (
              <div className="flex flex-wrap items-center gap-2" data-testid="ask-helpful">
                {state.rated === null ? (
                  <>
                    <span>{t.helpful}</span>
                    {([true, false] as const).map((helpful) => (
                      <button
                        key={String(helpful)}
                        type="button"
                        onClick={() => void rate(state.questionId!, helpful)}
                        className="min-h-11 rounded-lg border-2 border-current px-4 font-medium"
                      >
                        {helpful ? t.helpfulYes : t.helpfulNo}
                      </button>
                    ))}
                  </>
                ) : (
                  <span>{t.helpfulThanks}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {mic.supported && aiReady && state.phase !== "sending" && (
          <button
            type="button"
            onClick={() => (mic.listening && state.phase === "open" ? mic.stop() : openAndListen())}
            className="flex min-h-11 items-center gap-2 rounded-full border-2 border-blue-700 px-4 font-semibold"
          >
            <MicIcon /> {mic.listening && state.phase === "open" ? t.stopListening : t.button}
          </button>
        )}
        {state.phase === "answered" ? (
          <button type="button" onClick={resume} className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white">
            {t.continue}
          </button>
        ) : (
          <button type="button" onClick={resume} className="min-h-11 rounded-lg border-2 border-current px-4 font-medium">
            {t.close}
          </button>
        )}
      </div>

      {aiReady && state.phase !== "sending" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(typed);
          }}
        >
          <label htmlFor={`${id}-q`} className="w-full font-medium">
            {t.typeLabel}
          </label>
          <input
            id={`${id}-q`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={500}
            autoComplete="off"
            className="min-h-11 flex-1 rounded-lg border-2 border-zinc-400 bg-white px-3 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button type="submit" className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white">
            {t.send}
          </button>
        </form>
      )}
    </section>
  );
}

export function MicIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
