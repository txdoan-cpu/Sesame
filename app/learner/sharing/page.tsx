import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cardClass, linkClass } from "@/app/_components/styles";
import { requireRole } from "@/lib/auth/dal";
import { learnerMessages } from "@/lib/i18n";
import { getChildView } from "@/lib/portal";
import { SHARING_ITEMS } from "@/lib/sharing";
import en from "@/messages/en.json";
import { setSharing } from "../actions";

export const metadata: Metadata = { title: "What I share — Sesame" };

const t = learnerMessages.sharing;

export default function SharingPage() {
  return (
    <main lang="en-CA" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Sharing />
      </Suspense>
    </main>
  );
}

async function Sharing() {
  const user = await requireRole("learner");
  const { sharing } = await getChildView(user.id);

  return (
    <>
      <h1 className="text-3xl font-bold">{t.title}</h1>
      <p className="text-lg">{t.intro}</p>
      <ul className="flex flex-col gap-3" data-testid="sharing-list">
        {SHARING_ITEMS.map(({ item, locked }) => {
          const shared = sharing[item].shared;
          return (
            <li key={item} className={cardClass} data-testid={`sharing-${item}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-lg font-semibold">{t.items[item]}</p>
                <span
                  className={`rounded-full border-2 px-3 text-sm font-medium ${shared ? "border-green-700 text-green-900 dark:text-green-200" : "border-zinc-500"}`}
                  data-testid="sharing-state"
                >
                  {locked ? `🔒 ${t.locked}` : shared ? t.shared : t.private}
                </span>
              </div>
              {locked ? (
                <p className="text-base">{t.why[item as keyof typeof t.why]}</p>
              ) : (
                <form action={setSharing}>
                  <input type="hidden" name="item" value={item} />
                  <input type="hidden" name="shared" value={shared ? "false" : "true"} />
                  <button type="submit" className="min-h-11 rounded-lg border-2 border-blue-700 px-4 font-medium">
                    {shared ? t.turnOff : t.turnOn}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-4">
        <Link href="/learner/parent-view" className={linkClass}>
          {t.preview}
        </Link>
        <Link href="/learner" className={linkClass}>
          {t.back}
        </Link>
      </div>
    </>
  );
}
