import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cardClass } from "@/app/_components/styles";
import { getGeneratedLessons } from "@/lib/teacher/lessons";
import en from "@/messages/en.json";
import { StatusBadge, lessonTone } from "../StatusBadge";

export const metadata: Metadata = { title: "Generated lessons — Sesame" };

const t = en.teacher;
const g = en.teacher.gen;

export default function LessonsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Lessons />
      </Suspense>
    </main>
  );
}

async function Lessons() {
  const lessons = await getGeneratedLessons();
  return (
    <>
      <Link href="/teacher" className="inline-flex min-h-11 items-center self-start font-medium underline">
        ← {t.back}
      </Link>
      <h1 className="text-3xl font-bold">{g.listTitle}</h1>
      <p>{g.listIntro}</p>
      {lessons.length === 0 ? (
        <p>{g.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="generated-list">
          {lessons.map((l) => (
            <li key={l.id} className={cardClass}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{l.outcome_code}</span>
                <span>· {l.pseudonym}</span>
                <StatusBadge status={lessonTone(l.status)} label={g.status[l.status]} />
                {l.fit_score !== null && (
                  <span>
                    {g.score}: {l.fit_score}/100
                  </span>
                )}
              </div>
              <Link href={`/teacher/lesson/${l.id}`} className="inline-flex min-h-11 items-center self-start font-medium underline">
                {g.open}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
