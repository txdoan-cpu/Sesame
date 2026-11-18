import type { Metadata } from "next";
import { Suspense } from "react";
import { ChildProgress } from "@/app/_components/ChildProgress";
import { getCurriculum, getMisconceptionInfo } from "@/lib/curriculum";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { getChildView, getMyNotifications, getRewardRules, requireLinkedChild } from "@/lib/portal";
import en from "@/messages/en.json";
import { ChildHeader } from "./ChildHeader";

export const metadata: Metadata = { title: "Child progress — Sesame" };

export default function ChildProgressPage({ params }: PageProps<"/parent/child/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Progress params={params} />
      </Suspense>
    </main>
  );
}

async function Progress({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const child = await requireLinkedChild(id);
  const lang = await getLang();
  const t = parentMessages(lang);
  const [view, rewards, curriculum, misconceptionInfo, notifications] = await Promise.all([
    getChildView(id),
    getRewardRules(id),
    getCurriculum(),
    getMisconceptionInfo(),
    getMyNotifications(),
  ]);
  const safetyAlerts = notifications.filter((n) => n.type === "safety" && n.payload.learner_id === id);

  return (
    <>
      <ChildHeader childId={id} childName={child.displayName} current="progress" lang={lang} t={t.portal} langLabels={t.lang} />
      <ChildProgress
        view={view}
        rewards={rewards}
        curriculum={curriculum}
        misconceptionInfo={misconceptionInfo}
        safetyAlerts={safetyAlerts}
        t={t.portal}
        lang={lang}
      />
    </>
  );
}
