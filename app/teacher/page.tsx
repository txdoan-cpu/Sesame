import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { cardClass, inputClass } from "@/app/_components/styles";
import { requireStaff } from "@/lib/auth/dal";
import { getPacks } from "@/lib/teacher/data";
import en from "@/messages/en.json";
import { createPack } from "./actions";

export const metadata: Metadata = { title: "Teacher area — Sesame" };

const t = en.teacher;

export default function TeacherPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <TeacherHome />
      </Suspense>
    </main>
  );
}

async function TeacherHome() {
  const user = await requireStaff();
  const packs = await getPacks();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <p className="text-lg">{user.displayName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.role === "admin" && (
            <Link href="/admin" className="inline-flex min-h-11 items-center rounded-lg border-2 border-current px-4 font-medium">
              {t.adminLink}
            </Link>
          )}
          <LogoutButton label={t.logout} />
        </div>
      </header>
      <p>{t.intro}</p>

      <section aria-labelledby="packs-title" className="flex flex-col gap-3">
        <h2 id="packs-title" className="text-2xl font-semibold">
          {t.packsTitle}
        </h2>
        {packs.length === 0 ? (
          <p>{t.packsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="pack-list">
            {packs.map((p) => (
              <li key={p.id} className={cardClass}>
                <p className="text-lg font-semibold">
                  {p.province} · {t.grade} {p.grade} · {p.subject}
                </p>
                <p className="text-zinc-700 dark:text-zinc-300">
                  {p.source_title} · {p.published ? t.published : t.unpublished}
                </p>
                <Link
                  href={`/teacher/pack/${p.id}`}
                  className="inline-flex min-h-11 items-center self-start rounded-lg bg-blue-700 px-4 font-semibold text-white"
                >
                  {t.open}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-pack-title" className={cardClass}>
        <h2 id="new-pack-title" className="text-2xl font-semibold">
          {t.newPack}
        </h2>
        <ActionForm action={createPack} submitLabel={t.createPack} pendingLabel={en.auth.pending} errors={t.errors} testId="new-pack">
          <label className="flex flex-col gap-1">
            {t.province}
            <input name="province" required maxLength={2} defaultValue="NL" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.grade}
            <input name="grade" type="number" required min={1} max={12} defaultValue={8} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.subject}
            <input name="subject" required maxLength={60} defaultValue="Mathematics" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.sourceTitle}
            <input name="sourceTitle" required maxLength={200} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.sourceUrl}
            <input name="sourceUrl" type="url" maxLength={500} className={inputClass} />
          </label>
        </ActionForm>
      </section>
    </>
  );
}
