import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { OutcomeBoard } from "@/app/_components/OutcomeBoard";
import { requireRole } from "@/lib/auth/dal";
import { getCurriculum, getMyOutcomeStatus, getMyTargetOutcome } from "@/lib/curriculum";
import { learnerMessages } from "@/lib/i18n";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "My lessons — Sesame" };

const t = learnerMessages.home;

export default function LearnerPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <LearnerHome />
      </Suspense>
    </main>
  );
}

async function LearnerHome() {
  const user = await requireRole("learner");
  const [curriculum, status, target] = await Promise.all([
    getCurriculum(),
    getMyOutcomeStatus(),
    getMyTargetOutcome(),
  ]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.greeting.replace("{name}", user.displayName)}</h1>
        <LogoutButton label={t.logout} />
      </header>
      <p className="text-lg">{t.intro}</p>

      <section aria-labelledby="board-title" className="flex flex-col gap-4">
        <h2 id="board-title" className="text-2xl font-semibold">
          {t.boardTitle}
        </h2>
        <OutcomeBoard
          strands={curriculum.map((s) => ({
            code: s.code,
            name: s.name_en,
            outcomes: s.outcomes.map((o) => ({ code: o.code, text: o.parent_friendly })),
          }))}
          status={status}
          statusLabels={t.status}
          highlight={target ? { code: target, label: t.nextLesson } : null}
        />
      </section>
    </>
  );
}
