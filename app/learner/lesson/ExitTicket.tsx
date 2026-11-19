"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type { ExitView } from "@/lib/lesson/view";
import { learnerMessages } from "@/lib/i18n";
import { submitExitTicket, type ExitSummary } from "./actions";

const t = learnerMessages.lesson;
const statusLabels = learnerMessages.home.status;

type Done = Extract<ExitSummary, { ok: true }>;

/** 3 tap questions + 1 "explain in your own words". Scored on the server. */
type Props = {
  lessonId: string;
  exit: ExitView;
  /** "retention": the same check taken again later (§7.4). */
  kind?: "exit" | "retention";
  title?: string;
  onFinished?: () => void;
};

export function ExitTicket({ lessonId, exit, kind = "exit", title, onFinished }: Props) {
  const id = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  if (result) return <Results result={result} />;

  const complete = exit.choice.every((q) => choices[q.id]) && explanation.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) {
      setError(t.exit.needAll);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitExitTicket({ lessonId, choices, explanation, kind });
      if (res.ok) {
        setResult(res);
        onFinished?.();
      } else setError(t.exit.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="exit-ticket">
      <h2 className="text-2xl font-semibold">{title ?? t.exit.title}</h2>
      {exit.choice.map((q, qi) => (
        <fieldset key={q.id} className="flex flex-col gap-2 rounded-xl border-2 border-zinc-300 p-4 dark:border-zinc-700" data-testid={`exit-${q.id}`}>
          <legend className="px-1 text-lg">
            <span className="font-semibold">{qi + 1}. </span>
            <span dangerouslySetInnerHTML={{ __html: q.promptHtml }} />
          </legend>
          {q.options.map((o) => {
            const optionId = `${id}-${q.id}-${o.id}`;
            return (
              <label
                key={o.id}
                htmlFor={optionId}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 ${
                  choices[q.id] === o.id ? "border-blue-700 bg-blue-50 dark:bg-blue-950" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                <input
                  id={optionId}
                  type="radio"
                  name={q.id}
                  value={o.id}
                  checked={choices[q.id] === o.id}
                  onChange={() => setChoices((c) => ({ ...c, [q.id]: o.id }))}
                  className="h-5 w-5"
                />
                {o.text}
              </label>
            );
          })}
        </fieldset>
      ))}

      <div className="flex flex-col gap-2 rounded-xl border-2 border-zinc-300 p-4 dark:border-zinc-700">
        <label htmlFor={`${id}-explain`} className="text-lg">
          <span className="font-semibold">{exit.choice.length + 1}. </span>
          {exit.explainPrompt}
        </label>
        <textarea
          id={`${id}-explain`}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t.exit.explainLabel}
          className="rounded-lg border-2 border-zinc-400 bg-white p-3 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg bg-blue-700 px-6 font-semibold text-white disabled:opacity-60"
      >
        {pending ? t.exit.saving : t.exit.submit}
      </button>
    </form>
  );
}

function Results({ result }: { result: Done }) {
  const tips = [...new Set(result.items.flatMap((i) => (i.misconception ? [i.misconception] : [])))];
  return (
    <section className="flex flex-col gap-4" data-testid="lesson-results" aria-live="polite">
      <h2 className="text-3xl font-bold">{t.results.title}</h2>
      <p className="text-xl">
        {t.results.score.replace("{correct}", String(result.correctCount)).replace("{total}", String(result.total))}
      </p>
      <p className="text-xl">{result.mastered ? t.results.mastered : t.results.notYet}</p>
      <p>{result.explainedBalance ? t.results.explainedYes : t.results.explainedNo}</p>
      <p>
        {t.results.status}: <strong data-testid="result-status">{statusLabels[result.status]}</strong>
      </p>
      {tips.length > 0 && (
        <div className="rounded-xl border-2 border-amber-600 p-4">
          <h3 className="mb-2 text-xl font-semibold">{t.results.tipsTitle}</h3>
          <ul className="list-disc pl-6">
            {tips.map((m) => (
              <li key={m}>{t.tips[m as keyof typeof t.tips] ?? ""}</li>
            ))}
          </ul>
        </div>
      )}
      <Link href="/learner" className="inline-flex min-h-11 items-center self-start rounded-lg bg-blue-700 px-5 font-semibold text-white">
        {t.backHome}
      </Link>
    </section>
  );
}
