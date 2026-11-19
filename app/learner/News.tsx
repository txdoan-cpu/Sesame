import Link from "next/link";
import { cardClass, fill, secondaryButtonClass } from "@/app/_components/styles";
import { learnerMessages } from "@/lib/i18n";
import type { NotificationView } from "@/lib/portal";
import type { RetentionDue } from "@/lib/retention";
import { markMyNotificationRead } from "./actions";

const t = learnerMessages.home;

function text(n: NotificationView): string | null {
  const p = n.payload;
  const reward = String(p.reward_text ?? "");
  switch (n.type) {
    case "milestone": {
      const kind = String(p.kind) as "halfway" | "progress" | "all_reached";
      return fill(t.news[`milestone_${kind}` as const] ?? t.news.milestone_progress, {
        reward,
        outcomes: Array.isArray(p.outcomes) ? p.outcomes.join(", ") : "",
        achieved: Number(p.achieved ?? 0),
        total: Number(p.total ?? 0),
      });
    }
    case "reward_unlocked":
      return fill(t.news.reward_unlocked, { reward });
    case "reward_expired":
      return fill(t.news.reward_expired, { reward });
    default:
      return null;
  }
}

/** Milestones and rewards for the learner, plus a ready memory check. */
export function News({ notifications, checks }: { notifications: NotificationView[]; checks: RetentionDue[] }) {
  const items = notifications.filter((n) => !n.read_at).flatMap((n) => {
    const line = text(n);
    return line ? [{ n, line }] : [];
  });
  const ready = checks.filter((c) => c.ready);
  if (!items.length && !ready.length) return null;

  return (
    <section aria-labelledby="news" className={`${cardClass} border-blue-700`} data-testid="learner-news">
      <h2 id="news" className="text-2xl font-semibold">
        {t.newsTitle}
      </h2>
      {ready.map((c) => (
        <div key={c.outcome} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          <p className="font-semibold">{fill(t.checkReady, { outcome: c.outcome })}</p>
          <Link href="/learner/check" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-semibold text-white">
            {t.checkButton}
          </Link>
        </div>
      ))}
      <ul className="flex flex-col gap-2">
        {items.map(({ n, line }) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`news-${n.type}`}>
            <p>{line}</p>
            <form action={markMyNotificationRead}>
              <input type="hidden" name="id" value={n.id} />
              <button type="submit" className={secondaryButtonClass}>
                {t.dismiss}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
