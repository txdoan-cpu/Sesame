import type enMessages from "@/messages/en.json";
import { fill } from "@/app/_components/styles";
import type { NotificationView } from "@/lib/portal";

/** One line of text for a notification, in the parent's language. */
export function notificationText(n: NotificationView, t: typeof enMessages.portal): string {
  const p = n.payload;
  const name = String(p.learner_name ?? "");
  const types = t.notifications.types;
  switch (n.type) {
    case "safety":
      return fill(types.safety, {
        name,
        category: t.safetyCategory[String(p.category) as keyof typeof t.safetyCategory] ?? String(p.category),
      });
    case "schedule_request":
      return fill(types.schedule_request, { name });
    case "reward_accepted":
      return fill(types.reward_accepted, { name, reward: String(p.reward_text ?? "") });
    case "reward_suggestion":
      return fill(types.reward_suggestion, { name, reward: String(p.reward_text ?? ""), note: String(p.note ?? "") });
    case "idle":
      return fill(types.idle, { name, slide: num(p.slide_no), active: num(p.active_minutes), away: num(p.away_minutes) });
    case "missed_session": {
      const makeUp = (p.make_up ?? {}) as { weekday?: number; start_time?: string };
      return fill(types.missed_session, {
        name,
        day: t.days[num(p.weekday)] ?? "",
        time: String(p.start_time ?? ""),
        makeUpDay: t.days[makeUp.weekday ?? 0] ?? "",
        makeUpTime: makeUp.start_time ?? "",
      });
    }
    case "milestone": {
      const kind = String(p.kind) as "halfway" | "progress" | "all_reached";
      const template = types[`milestone_${kind}` as const] ?? types.milestone_progress;
      return fill(template, {
        name,
        reward: String(p.reward_text ?? ""),
        outcomes: Array.isArray(p.outcomes) ? p.outcomes.join(", ") : "",
        achieved: num(p.achieved),
        total: num(p.total),
      });
    }
    case "reward_unlocked":
      return fill(types.reward_unlocked, { name, reward: String(p.reward_text ?? ""), praise: String(p.praise ?? "") });
    case "reward_expired":
      return fill(types.reward_expired, { name, reward: String(p.reward_text ?? "") });
    case "weekly_summary":
      return fill(types.weekly_summary, { name, attended: num(p.attended), scheduled: num(p.scheduled), active: num(p.activeMinutes) });
    default:
      return fill(types.other, { name });
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
