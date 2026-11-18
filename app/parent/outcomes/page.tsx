import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LangToggle } from "@/app/_components/LangToggle";
import { OutcomeBoard } from "@/app/_components/OutcomeBoard";
import { requireRole } from "@/lib/auth/dal";
import { getCurriculum } from "@/lib/curriculum";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "Grade 8 math outcomes — Sesame" };

export default function ParentOutcomesPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <ParentOutcomes />
      </Suspense>
    </main>
  );
}

async function ParentOutcomes() {
  await requireRole("parent");
  const lang = await getLang();
  const t = parentMessages(lang);
  const curriculum = await getCurriculum();

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.parent.outcomes.title}</h1>
        <LangToggle current={lang} labels={t.lang} />
      </header>
      <p className="text-lg">{t.parent.outcomes.intro}</p>
      {/* Curriculum only. A child's status appears here in Round 5, through sharing-aware views. */}
      <OutcomeBoard
        strands={curriculum.map((s) => ({
          code: s.code,
          name: lang === "vi" ? s.name_vi : s.name_en,
          outcomes: s.outcomes.map((o) => ({
            code: o.code,
            text: lang === "vi" ? o.description_vi : o.parent_friendly,
          })),
        }))}
      />
      <Link href="/parent" className="inline-flex min-h-11 items-center self-start font-medium underline">
        {t.parent.outcomes.back}
      </Link>
    </>
  );
}
