import type { Metadata } from "next";
import { Suspense } from "react";
import "katex/dist/katex.min.css";
import { learnerMessages } from "@/lib/i18n";
import { getLessonForOutcome } from "@/lib/lesson/registry";
import { toLessonView } from "@/lib/lesson/view";
import { getMyRetentionChecks } from "@/lib/retention";
import en from "@/messages/en.json";
import { CheckClient } from "./CheckClient";

export const metadata: Metadata = { title: "Memory check — Sesame" };

const t = learnerMessages.check;

/** Retention check: the same exit ticket, taken again days later (§6, §7.4). */
export default function CheckPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="text-3xl font-bold">{t.title}</h1>
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Check />
      </Suspense>
    </main>
  );
}

async function Check() {
  const due = (await getMyRetentionChecks()).find((d) => d.ready && getLessonForOutcome(d.outcome));
  const lesson = due ? getLessonForOutcome(due.outcome) : null;
  return (
    <CheckClient
      ready={Boolean(due && lesson)}
      outcome={due?.outcome ?? null}
      lessonId={lesson?.id ?? null}
      exit={lesson ? toLessonView(lesson).exit : null}
    />
  );
}
