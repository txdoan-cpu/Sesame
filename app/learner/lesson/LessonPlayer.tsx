"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonView } from "@/lib/lesson/view";
import { learnerMessages } from "@/lib/i18n";
import { Checkpoint, NumericCheck, type ItemOutcome } from "./Checkpoint";
import { ExitTicket } from "./ExitTicket";
import { Visual } from "./Visuals";
import { useNarration } from "./useNarration";

const t = learnerMessages.lesson;

type Phase = "start" | "diagnostic" | "slides" | "exit";

export function LessonPlayer({ lesson, needsDiagnostic, minutes }: { lesson: LessonView; needsDiagnostic: boolean; minutes: number }) {
  const [phase, setPhase] = useState<Phase>("start");
  const [index, setIndex] = useState(0);
  const [diagIndex, setDiagIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, ItemOutcome>>({});
  const narration = useNarration();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const slide = lesson.slides[index];
  const isLast = index === lesson.slides.length - 1;
  const checkpointDone = !slide.checkpoint || slide.checkpoint.every((item) => outcomes[item.id]);

  // Narrate each slide as it opens (the Start button was the user gesture).
  const { speak, stop } = narration;
  useEffect(() => {
    if (phase !== "slides") return;
    speak(lesson.slides[index].narration);
    headingRef.current?.focus();
    return () => stop();
  }, [phase, index, lesson.slides, speak, stop]);

  const recordOutcome = (o: ItemOutcome) => setOutcomes((prev) => ({ ...prev, [o.id]: o }));

  if (phase === "start") {
    return (
      <section className="flex flex-col gap-4 rounded-xl border-2 border-zinc-300 p-6 dark:border-zinc-700">
        <h1 className="text-3xl font-bold">{lesson.title}</h1>
        <p className="text-lg">{t.minutes.replace("{n}", String(minutes))}</p>
        <p>{t.startHint}</p>
        <button
          type="button"
          onClick={() => setPhase(needsDiagnostic ? "diagnostic" : "slides")}
          className="min-h-11 self-start rounded-lg bg-blue-700 px-6 text-lg font-semibold text-white"
        >
          {t.start}
        </button>
      </section>
    );
  }

  if (phase === "diagnostic") {
    const item = lesson.diagnostic[diagIndex];
    const lastDiag = diagIndex === lesson.diagnostic.length - 1;
    return (
      <section className="flex flex-col gap-4" data-testid="diagnostic">
        <h1 className="text-3xl font-bold">{t.diagnostic.title}</h1>
        <p>{t.diagnostic.intro}</p>
        <NumericCheck key={item.id} item={{ ...item, hints: item.hints.slice(0, 1) }} done={outcomes[item.id]} onDone={recordOutcome} />
        <button
          type="button"
          disabled={!outcomes[item.id]}
          onClick={() => (lastDiag ? setPhase("slides") : setDiagIndex((i) => i + 1))}
          className="min-h-11 self-start rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-50"
        >
          {lastDiag ? t.diagnostic.done : t.diagnostic.next}
        </button>
      </section>
    );
  }

  if (phase === "exit") {
    return <ExitTicket lessonId={lesson.id} exit={lesson.exit} />;
  }

  return (
    <article className="flex flex-col gap-5" data-testid="lesson-player" aria-labelledby="slide-title">
      <div className="flex flex-col gap-2">
        <p className="text-base text-zinc-700 dark:text-zinc-300" data-testid="slide-progress">
          {t.slideOf.replace("{n}", String(index + 1)).replace("{total}", String(lesson.slides.length))}
        </p>
        <div className="h-2 w-full rounded bg-zinc-200 dark:bg-zinc-800" aria-hidden>
          <div className="h-2 rounded bg-blue-700" style={{ width: `${((index + 1) / lesson.slides.length) * 100}%` }} />
        </div>
      </div>

      <h2 id="slide-title" ref={headingRef} tabIndex={-1} className="text-3xl font-bold focus:outline-none">
        {slide.title}
      </h2>

      <div className="lesson-body flex flex-col gap-3 text-xl" dangerouslySetInnerHTML={{ __html: slide.bodyHtml }} />

      <Visual visual={slide.visual} />

      <aside className="flex flex-col gap-2 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900" aria-label={t.narration.label}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{t.narration.label}</p>
          {narration.supported ? (
            <button
              type="button"
              onClick={() => (narration.speaking ? stop() : speak(slide.narration))}
              className="min-h-11 rounded-lg border-2 border-current px-4 font-medium"
            >
              {narration.speaking ? t.narration.stop : t.narration.replay}
            </button>
          ) : (
            <p className="text-base">{t.narration.unsupported}</p>
          )}
        </div>
        <p data-testid="narration-text">{slide.narration}</p>
      </aside>

      {slide.checkpoint && <Checkpoint items={slide.checkpoint} done={outcomes} onItemDone={recordOutcome} />}

      <nav className="flex flex-wrap items-center gap-3" aria-label="Lesson navigation">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
          className="min-h-11 rounded-lg border-2 border-current px-5 font-medium disabled:opacity-40"
        >
          {t.back}
        </button>
        <button
          type="button"
          disabled={!checkpointDone}
          onClick={() => (isLast ? setPhase("exit") : setIndex((i) => i + 1))}
          className="min-h-11 rounded-lg bg-blue-700 px-6 font-semibold text-white disabled:opacity-50"
        >
          {isLast ? t.toExit : t.next}
        </button>
        {!checkpointDone && <p className="text-base text-zinc-700 dark:text-zinc-300">{t.check.needAnswer}</p>}
      </nav>
    </article>
  );
}
