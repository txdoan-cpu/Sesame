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
    default:
      return fill(types.other, { name });
  }
}
