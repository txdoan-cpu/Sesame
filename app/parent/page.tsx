import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/app/_components/AuthForm";
import { LangToggle } from "@/app/_components/LangToggle";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { getLinkedChildren, requireRole } from "@/lib/auth/dal";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import en from "@/messages/en.json";
import { getMyNotifications } from "@/lib/portal";
import { createLearner } from "./actions";

export const metadata: Metadata = { title: "Parent dashboard — Sesame" };

export default function ParentPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <ParentDashboard />
      </Suspense>
    </main>
  );
}

async function ParentDashboard() {
  const user = await requireRole("parent");
  const lang = await getLang();
  const t = parentMessages(lang);
  const [children, notifications] = await Promise.all([getLinkedChildren(), getMyNotifications()]);
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.parent.title}</h1>
          <p className="text-lg">{t.parent.welcome.replace("{name}", user.displayName)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/parent/notifications"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-current px-4 font-medium"
            data-testid="notifications-link"
          >
            {t.portal.notifications.link}
            {unread > 0 && (
              <span className="rounded-full bg-red-700 px-2 text-sm font-semibold text-white">
                {t.portal.notifications.unread.replace("{n}", String(unread))}
              </span>
            )}
          </Link>
          <LangToggle current={lang} labels={t.lang} />
          <LogoutButton label={t.auth.logout} />
        </div>
      </header>

      <section aria-labelledby="children-title" className="flex flex-col gap-3">
        <h2 id="children-title" className="text-2xl font-semibold">
          {t.parent.childrenTitle}
        </h2>
        {children.length === 0 ? (
          <p>{t.parent.noChildren}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="children-list">
            {children.map((child) => (
              <li key={child.id} className="rounded-lg border-2 border-zinc-300 p-4 dark:border-zinc-700">
                <p className="text-lg font-semibold">{child.displayName}</p>
                <p className="text-zinc-700 dark:text-zinc-300">
                  {t.parent.logsInAs}: <span className="font-mono">{child.username}</span>
                </p>
                <Link
                  href={`/parent/child/${child.id}`}
                  className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-semibold text-white"
                >
                  {t.portal.openChild.replace("{name}", child.displayName)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/parent/outcomes" className="inline-flex min-h-11 items-center self-start font-medium underline">
          {t.parent.outcomesLink}
        </Link>
      </section>

      <section
        aria-labelledby="add-child-title"
        className="flex flex-col gap-4 rounded-xl border-2 border-zinc-300 p-5 dark:border-zinc-700"
      >
        <h2 id="add-child-title" className="text-2xl font-semibold">
          {t.parent.addChildTitle}
        </h2>
        <p>{t.parent.addChildIntro}</p>
        <AuthForm
          testId="add-child"
          action={createLearner}
          fields={[
            { name: "displayName", label: t.parent.childName, autoComplete: "off", maxLength: 60 },
            {
              name: "username",
              label: t.parent.username,
              autoComplete: "off",
              hint: t.parent.usernameHint,
              minLength: 3,
              maxLength: 20,
              pattern: "[A-Za-z0-9_]{3,20}",
            },
            {
              name: "password",
              label: t.parent.childPassword,
              type: "password",
              autoComplete: "new-password",
              hint: t.auth.passwordHint,
              minLength: 8,
              maxLength: 72,
            },
          ]}
          submitLabel={t.parent.addChildButton}
          pendingLabel={t.auth.pending}
          errors={t.auth.errors}
          successMessage={t.parent.childCreated}
        />
      </section>
    </>
  );
}
