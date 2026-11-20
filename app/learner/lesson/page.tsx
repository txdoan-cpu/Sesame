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
import { after } from "next/server";
import { isGenerating, runPipeline, shouldGenerateFor, startLesson } from "@/lib/generation/pipeline";
import { todaysLesson } from "@/lib/lesson/library";
import { toLessonView } from "@/lib/lesson/view";
import { levelFromProfile } from "@/lib/learner/model";
import { paceFor } from "@/lib/learner/pace";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import { LessonPlayer } from "./LessonPlayer";

export const metadata: Metadata = { title: "Today's lesson — Sesame" };
// Lesson generation and AI scoring can take a minute or more on Vercel (§7.9).
export const maxDuration = 300;

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
  const today = target ? await todaysLesson(user.id, target) : null;
  const lesson = today?.lesson ?? null;

  // §7.9 (owner decision, Round 10): when the goal has approved materials, make a
  // personalised lesson in the background. Today the learner gets the standard lesson;
  // the new one is used once the critic delivers it (>= 75) or a teacher approves it.
  let preparing = false;
  if (target && !today?.generated) {
    if (await shouldGenerateFor(user.id, target)) {
      const id = await startLesson(target, { kind: "learner", learnerId: user.id });
      after(() => runPipeline(id, target, { kind: "learner", learnerId: user.id }, []));
      preparing = true;
    } else {
      preparing = await isGenerating(user.id, target);
    }
  }

  if (!lesson) {
    return (
      <>
        <p className="text-xl" data-testid="no-lesson">
          {preparing ? t.preparing : t.noLesson}
        </p>
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
    .select("confidence, learning_rate")
    .eq("learner_id", user.id)
    .maybeSingle();
  const confidence = z.object({ confidence: z.coerce.number() }).safeParse(data);
  const diagnostic = needsDiagnostic({ confidence_of_estimate: confidence.success ? confidence.data.confidence : 0 });

  // §7.8 automatic pacing: the learner's learning rate (slow / medium / fast) picks the practice set and narration speed.
  const pace = paceFor(levelFromProfile(data?.learning_rate));

  return (
    <LessonPlayer
      lesson={toLessonView(lesson, pace.level)}
      needsDiagnostic={diagnostic}
      minutes={lesson.minutes}
      aiReady={llmConfigured()}
      pace={{ level: pace.level, narrationRate: pace.narrationRate }}
      generated={today?.generated ?? false}
    />
  );
}
