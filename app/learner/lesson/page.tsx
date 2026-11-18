import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import "katex/dist/katex.min.css";
import { requireRole } from "@/lib/auth/dal";
import { getMyTargetOutcome } from "@/lib/curriculum";
import { learnerMessages } from "@/lib/i18n";
import { needsDiagnostic } from "@/lib/learner-profile";
import { llmConfigured } from "@/lib/llm";
import { getLessonForOutcome } from "@/lib/lesson/registry";
import { toLessonView } from "@/lib/lesson/view";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import { LessonPlayer } from "./LessonPlayer";

export const metadata: Metadata = { title: "Today's lesson — Sesame" };

const t = learnerMessages.lesson;

export default function LessonPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Lesson />
      </Suspense>
    </main>
  );
}

async function Lesson() {
  const user = await requireRole("learner");
  const target = await getMyTargetOutcome();
  const lesson = target ? getLessonForOutcome(target) : null;

  if (!lesson) {
    return (
      <>
        <p className="text-xl">{t.noLesson}</p>
        <Link href="/learner" className="inline-flex min-h-11 items-center self-start font-medium underline">
          {t.backHome}
        </Link>
      </>
    );
  }

  // §9: if the profile estimate is unsure (< 0.6), start with diagnostic questions.
  const supabase = await createClient();
  const { data } = await supabase
    .from("learner_profiles")
    .select("confidence")
    .eq("learner_id", user.id)
    .maybeSingle();
  const confidence = z.object({ confidence: z.coerce.number() }).safeParse(data);
  const diagnostic = needsDiagnostic({ confidence_of_estimate: confidence.success ? confidence.data.confidence : 0 });

  return (
    <LessonPlayer lesson={toLessonView(lesson)} needsDiagnostic={diagnostic} minutes={lesson.minutes} aiReady={llmConfigured()} />
  );
}
