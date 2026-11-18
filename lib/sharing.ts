/**
 * Sharing rules (CLAUDE.md §7.3). Single source of truth: the database
 * defaults in supabase/migrations/*_parent_portal.sql must match this list,
 * and a test checks that they do.
 */

export const SHARING_ITEMS = [
  // Studied on schedule, active time, idle alerts.
  { item: "attendance", defaultShared: true, locked: true },
  // Safety alerts (possible abuse goes to safety_reviews instead, §7.2).
  { item: "safety_alerts", defaultShared: true, locked: true },
  // Reward goals: achieved / not and % progress only.
  { item: "reward_progress", defaultShared: true, locked: true },
  { item: "outcome_status", defaultShared: true, locked: false },
  // Lesson scores and exit tickets.
  { item: "scores", defaultShared: true, locked: false },
  { item: "question_summaries", defaultShared: false, locked: false },
  { item: "misconceptions", defaultShared: false, locked: false },
] as const;

export type SharingItem = (typeof SHARING_ITEMS)[number]["item"];

export const SHARING_ITEM_NAMES: readonly SharingItem[] = SHARING_ITEMS.map((s) => s.item);

export function isSharingItem(value: string): value is SharingItem {
  return (SHARING_ITEM_NAMES as readonly string[]).includes(value);
}

export function sharingRule(item: SharingItem) {
  return SHARING_ITEMS.find((s) => s.item === item)!;
}

/** A learner may change an item only when it is not locked. */
export function canLearnerChange(item: SharingItem): boolean {
  return !sharingRule(item).locked;
}

/** Effective sharing for one learner: stored choices over defaults; locked items are always shared. */
export function effectiveSharing(stored: { item: string; shared: boolean }[]): Record<SharingItem, boolean> {
  const out = Object.fromEntries(SHARING_ITEMS.map((s) => [s.item, s.defaultShared])) as Record<SharingItem, boolean>;
  for (const row of stored) {
    if (!isSharingItem(row.item)) continue;
    out[row.item] = sharingRule(row.item).locked ? true : row.shared;
  }
  return out;
}
