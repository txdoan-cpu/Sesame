const tone: Record<string, string> = {
  approved: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  draft: "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
};

/** A small coloured label; the text carries the meaning, the colour only helps. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone[status] ?? tone.draft}`} data-testid="status-badge">
      {label}
    </span>
  );
}
