import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChildProgress } from "@/app/_components/ChildProgress";
import { linkClass } from "@/app/_components/styles";
import { requireRole } from "@/lib/auth/dal";
import { getCurriculum, getMisconceptionInfo } from "@/lib/curriculum";
import { learnerMessages } from "@/lib/i18n";
import { getChildView, getRationale, getRewardRules, getThisWeek } from "@/lib/portal";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "What my parent sees — Sesame" };

const t = learnerMessages.parentView;

/**
 * Reads the same sharing-aware views the parent reads, and renders the same
 * component, so the learner sees exactly what the parent sees (§7.3).
 */
export default function ParentViewPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <ParentView />
      </Suspense>
    </main>
  );
}

async function ParentView() {
  const user = await requireRole("learner");
  const [view, rewards, curriculum, misconceptionInfo, week] = await Promise.all([
    getChildView(user.id),
    getRewardRules(user.id),
    getCurriculum(),
    getMisconceptionInfo(),
    getThisWeek(user.id),
  ]);

  const rationale = await getRationale(user.id, view.sharing);

  return (
    <>
      <h1 className="text-3xl font-bold">{t.title}</h1>
      <p className="text-lg">{t.intro}</p>
      <div className="flex flex-wrap gap-4">
        <Link href="/learner/sharing" className={linkClass}>
          {t.change}
        </Link>
        <Link href="/learner" className={linkClass}>
          {t.back}
        </Link>
      </div>
      <ChildProgress
        view={view}
        rewards={rewards}
        curriculum={curriculum}
        misconceptionInfo={misconceptionInfo}
        safetyAlerts={null}
        week={week}
        rationale={rationale}
        t={en.portal}
        lang="en"
      />
    </>
  );
}
