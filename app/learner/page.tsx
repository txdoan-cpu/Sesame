import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { requireRole } from "@/lib/auth/dal";
import { learnerMessages } from "@/lib/i18n";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "My lessons — Sesame" };

const t = learnerMessages.home;

export default function LearnerPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <LearnerHome />
      </Suspense>
    </main>
  );
}

async function LearnerHome() {
  const user = await requireRole("learner");
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.greeting.replace("{name}", user.displayName)}</h1>
        <LogoutButton label={t.logout} />
      </header>
      <p className="text-lg">{t.intro}</p>
    </>
  );
}
