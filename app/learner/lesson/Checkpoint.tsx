"use client";

import { useId, useState } from "react";
import { answerMatches, parseNumericAnswer } from "@/lib/math/answer";
import type { ChoiceItemView, CheckItemView, NumericItemView } from "@/lib/lesson/view";
import { learnerMessages } from "@/lib/i18n";
import { MicIcon } from "./AskPanel";
import { useSpeechRecognition } from "./useSpeechRecognition";

const t = learnerMessages.lesson.check;

export type ItemOutcome = { id: string; correct: boolean; attempts: number; hintsUsed: number; revealed: boolean };

type Props = {
  items: CheckItemView[];
  onItemDone: (outcome: ItemOutcome) => void;
  /** Ids already finished (keeps state when the learner goes back). */
  done: Record<string, ItemOutcome>;
};

/** Slide check-in. Every item must be answered (or revealed) before moving on. */
export function Checkpoint({ items, onItemDone, done }: Props) {
  return (
    <section aria-label={t.title} className="flex flex-col gap-4 rounded-xl border-2 border-blue-700 p-4">
      <h3 className="text-xl font-semibold">{t.title}</h3>
      {items.map((item) =>
        item.kind === "numeric" ? (
          <NumericCheck key={item.id} item={item} done={done[item.id]} onDone={onItemDone} />
        ) : (
          <ChoiceCheck key={item.id} item={item} done={done[item.id]} onDone={onItemDone} />
        ),
      )}
    </section>
  );
}

export function NumericCheck({
  item,
  done,
  onDone,
}: {
  item: NumericItemView;
  done?: ItemOutcome;
  onDone: (o: ItemOutcome) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const finished = Boolean(done);
  const outOfHints = hintsShown >= item.hints.length;

  const mic = useSpeechRecognition();

  function check(e: React.FormEvent) {
    e.preventDefault();
    submit(value);
  }

  /** Spoken answers ("minus four", "x equals 5") fill the box and are checked straight away. */
  function listen() {
    if (mic.listening) return mic.stop();
    mic.start((text) => {
      setValue(text);
      submit(text);
    });
  }

  function submit(value: string) {
    if (finished) return;
    if (parseNumericAnswer(value) === null) {
      setMessage(t.notANumber);
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    if (answerMatches(value, item.answer)) {
      setMessage(null);
      onDone({ id: item.id, correct: true, attempts: next, hintsUsed: hintsShown, revealed: false });
    } else {
      setMessage(t.tryAgain);
      // A wrong answer brings the next hint, gentlest first.
      if (!outOfHints) setHintsShown((h) => h + 1);
    }
  }

  function reveal() {
    onDone({ id: item.id, correct: false, attempts, hintsUsed: hintsShown, revealed: true });
  }

  return (
    <form onSubmit={check} className="flex flex-col gap-2" data-testid={`check-${item.id}`}>
      <label htmlFor={id} className="text-lg" dangerouslySetInnerHTML={{ __html: item.promptHtml }} />
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="text"
          autoComplete="off"
          disabled={finished}
          aria-describedby={`${id}-msg`}
          placeholder={t.answerLabel}
          className="min-h-11 w-40 rounded-lg border-2 border-zinc-400 bg-white px-3 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button type="submit" disabled={finished} className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-60">
          {t.submit}
        </button>
        {mic.supported && !finished && (
          <button
            type="button"
            onClick={listen}
            aria-pressed={mic.listening}
            className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-blue-700 px-4 font-medium"
          >
            <MicIcon /> {mic.listening ? t.listening : t.speak}
          </button>
        )}
        {!finished && !outOfHints && (
          <button
            type="button"
            onClick={() => setHintsShown((h) => h + 1)}
            className="min-h-11 rounded-lg border-2 border-blue-700 px-4 font-medium"
          >
            {t.hint}
          </button>
        )}
        {!finished && outOfHints && attempts > 0 && (
          <button type="button" onClick={reveal} className="min-h-11 rounded-lg border-2 border-zinc-500 px-4 font-medium">
            {t.showAnswer}
          </button>
        )}
      </div>
      <div id={`${id}-msg`} aria-live="polite" className="flex flex-col gap-1">
        {!finished && message && <p className="font-medium text-amber-900 dark:text-amber-200">{message}</p>}
        {!finished &&
          item.hints.slice(0, hintsShown).map((h, i) => (
            <p key={i} className="rounded-lg bg-amber-50 p-2 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
              <strong>{t.hintLabel.replace("{n}", String(i + 1))}:</strong> {h}
            </p>
          ))}
        {done?.correct && <p className="rounded-lg bg-green-50 p-2 font-medium text-green-900 dark:bg-green-950 dark:text-green-100">{item.correctFeedback}</p>}
        {done?.revealed && (
          <p className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
            {t.answerWas.replace("{answer}", String(item.answer))}
          </p>
        )}
      </div>
    </form>
  );
}

function ChoiceCheck({
  item,
  done,
  onDone,
}: {
  item: ChoiceItemView;
  done?: ItemOutcome;
  onDone: (o: ItemOutcome) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const feedback = item.options.find((o) => o.id === (done ? item.options.find((x) => x.correct)?.id : picked));

  function choose(optionId: string) {
    if (done) return;
    const option = item.options.find((o) => o.id === optionId);
    if (!option) return;
    const next = attempts + 1;
    setAttempts(next);
    setPicked(optionId);
    if (option.correct) onDone({ id: item.id, correct: next === 1, attempts: next, hintsUsed: 0, revealed: false });
  }

  return (
    <fieldset className="flex flex-col gap-2" data-testid={`check-${item.id}`}>
      <legend className="mb-2 text-lg" dangerouslySetInnerHTML={{ __html: item.promptHtml }} />
      {item.options.map((o) => {
        const isPicked = picked === o.id || (done && o.correct);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => choose(o.id)}
            disabled={Boolean(done)}
            aria-pressed={Boolean(isPicked)}
            className={`min-h-11 rounded-lg border-2 px-4 py-2 text-left ${
              isPicked && o.correct
                ? "border-green-700 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-50"
                : isPicked
                  ? "border-amber-600 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50"
                  : "border-zinc-400"
            }`}
          >
            {o.text}
          </button>
        );
      })}
      <p aria-live="polite" className="min-h-6 font-medium">
        {feedback?.feedback}
      </p>
    </fieldset>
  );
}
