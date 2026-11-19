import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { cardClass, inputClass, secondaryButtonClass } from "@/app/_components/styles";
import { requireRole } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import en from "@/messages/en.json";
import { createTeacher, removeTeacher } from "./actions";

export const metadata: Metadata = { title: "Admin — Sesame" };

const t = en.admin;

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Admin />
      </Suspense>
    </main>
  );
}

type TeacherRow = { id: string; displayName: string; email: string };

/** Teachers with their emails (service role: profiles has no email column). Admin only. */
async function listTeachers(): Promise<TeacherRow[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, display_name").eq("role", "teacher").order("display_name");
  const rows = data ?? [];
  const emails = await Promise.all(rows.map((p) => admin.auth.admin.getUserById(p.id as string)));
  return rows.map((p, i) => ({ id: p.id as string, displayName: p.display_name as string, email: emails[i].data.user?.email ?? "" }));
}

async function Admin() {
  const user = await requireRole("admin");
  const teachers = await listTeachers();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <p className="text-lg">{user.displayName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/teacher" className={`inline-flex items-center ${secondaryButtonClass}`}>
            {t.teacherArea}
          </Link>
          <LogoutButton label={t.logout} />
        </div>
      </header>
      <p>{t.intro}</p>

      <section aria-labelledby="teachers-title" className="flex flex-col gap-3">
        <h2 id="teachers-title" className="text-2xl font-semibold">
          {t.teachersTitle}
        </h2>
        {teachers.length === 0 ? (
          <p>{t.teachersEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="teacher-list">
            {teachers.map((x) => (
              <li key={x.id} className={`${cardClass} sm:flex-row sm:items-center sm:justify-between`}>
                <div>
                  <p className="font-semibold">{x.displayName}</p>
                  <p className="break-all text-zinc-700 dark:text-zinc-300">{x.email}</p>
                </div>
                <form action={removeTeacher}>
                  <input type="hidden" name="id" value={x.id} />
                  <button type="submit" className={secondaryButtonClass}>
                    {t.remove}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-teacher-title" className={cardClass}>
        <h2 id="new-teacher-title" className="text-2xl font-semibold">
          {t.newTeacher}
        </h2>
        <ActionForm action={createTeacher} submitLabel={t.create} pendingLabel={en.auth.pending} errors={t.errors} success={t.created} testId="new-teacher">
          <label className="flex flex-col gap-1">
            {t.displayName}
            <input name="displayName" required maxLength={60} autoComplete="off" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.email}
            <input name="email" type="email" required autoComplete="off" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            {t.password}
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t.passwordHint}</span>
            <input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={inputClass} />
          </label>
        </ActionForm>
      </section>
    </>
  );
}
