import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LangToggle } from "@/app/_components/LangToggle";
import { cardClass, secondaryButtonClass } from "@/app/_components/styles";
import { requireRole } from "@/lib/auth/dal";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { getMyNotifications } from "@/lib/portal";
import en from "@/messages/en.json";
import { markNotificationRead } from "../child/actions";
import { notificationText } from "./text";

export const metadata: Metadata = { title: "Notifications — Sesame" };

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Notifications />
      </Suspense>
    </main>
  );
}

async function Notifications() {
  await requireRole("parent");
  const lang = await getLang();
  const t = parentMessages(lang);
  const list = await getMyNotifications();

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/parent" className="inline-flex min-h-11 items-center underline">
            ← {t.portal.nav.back}
          </Link>
          <h1 className="text-3xl font-bold">{t.portal.notifications.title}</h1>
        </div>
        <LangToggle current={lang} labels={t.lang} />
      </header>
      {list.length === 0 ? (
        <p>{t.portal.notifications.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="notifications">
          {list.map((n) => (
            <li
              key={n.id}
              className={`${cardClass} ${n.read_at ? "" : "border-blue-700"} ${n.type === "safety" ? "bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50" : ""}`}
              data-testid={`notification-${n.type}`}
            >
              <p className={n.read_at ? "" : "font-semibold"}>{notificationText(n, t.portal)}</p>
              {n.type === "safety" && <p>{t.portal.safetyAdvice}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <time dateTime={n.created_at} className="text-base text-zinc-700 dark:text-zinc-300">
                  {new Date(n.created_at).toLocaleString(lang === "vi" ? "vi-VN" : "en-CA")}
                </time>
                {!n.read_at && (
                  <form action={markNotificationRead}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className={secondaryButtonClass}>
                      {t.portal.notifications.markRead}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
