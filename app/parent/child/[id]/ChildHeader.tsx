import Link from "next/link";
import type en from "@/messages/en.json";
import { LangToggle } from "@/app/_components/LangToggle";
import type { Lang } from "@/lib/i18n";

type Tab = "progress" | "rewards" | "schedule" | "account";

type Props = {
  childId: string;
  childName: string;
  current: Tab;
  lang: Lang;
  t: typeof en.portal;
  langLabels: { label: string; en: string; vi: string };
};

/** Child name, tabs and language switch for every page about one child. */
export function ChildHeader({ childId, childName, current, lang, t, langLabels }: Props) {
  const tabs: { key: Tab; href: string }[] = [
    { key: "progress", href: `/parent/child/${childId}` },
    { key: "rewards", href: `/parent/child/${childId}/rewards` },
    { key: "schedule", href: `/parent/child/${childId}/schedule` },
    { key: "account", href: `/parent/child/${childId}/account` },
  ];
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/parent" className="inline-flex min-h-11 items-center underline">
            ← {t.nav.back}
          </Link>
          <h1 className="text-3xl font-bold">{childName}</h1>
        </div>
        <LangToggle current={lang} labels={langLabels} />
      </div>
      <nav aria-label={childName} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border-2 px-4 font-medium ${
              tab.key === current ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-400"
            }`}
          >
            {t.nav[tab.key]}
          </Link>
        ))}
      </nav>
    </header>
  );
}
