import type { OutcomeStatusKind } from "@/lib/learner-profile";

export type BoardStrand = {
  code: string;
  name: string;
  outcomes: { code: string; text: string }[];
};

type Props = {
  strands: BoardStrand[];
  /** When given, each outcome shows a status badge (learner view). */
  status?: Record<string, OutcomeStatusKind>;
  statusLabels?: Record<OutcomeStatusKind, string>;
  highlight?: { code: string; label: string } | null;
};

const badgeClass: Record<OutcomeStatusKind, string> = {
  not_started: "border-zinc-400 text-zinc-800 dark:text-zinc-200",
  learning: "border-amber-600 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  nearly: "border-blue-700 bg-blue-50 text-blue-950 dark:bg-blue-950 dark:text-blue-100",
  achieved: "border-green-700 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-100",
  retained: "border-green-800 bg-green-700 text-white",
};

/** Outcomes grouped by strand. Status is shown as text, never by colour alone. */
export function OutcomeBoard({ strands, status, statusLabels, highlight }: Props) {
  return (
    <div className="flex flex-col gap-8" data-testid="outcome-board">
      {strands.map((strand) => (
        <section key={strand.code} aria-labelledby={`strand-${strand.code}`} className="flex flex-col gap-3">
          <h3 id={`strand-${strand.code}`} className="text-xl font-semibold">
            {strand.name}
          </h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {strand.outcomes.map((o) => {
              const s = status ? (status[o.code] ?? "not_started") : null;
              const isTarget = highlight?.code === o.code;
              return (
                <li
                  key={o.code}
                  data-testid={`outcome-${o.code}`}
                  className={`flex flex-col gap-2 rounded-lg border-2 p-4 ${
                    isTarget ? "border-blue-700" : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{o.code}</span>
                    {isTarget && (
                      <span className="rounded-full bg-blue-700 px-3 text-sm font-semibold text-white">
                        {highlight.label}
                      </span>
                    )}
                    {s && statusLabels && (
                      <span className={`ml-auto rounded-full border-2 px-3 text-sm font-medium ${badgeClass[s]}`}>
                        {statusLabels[s]}
                      </span>
                    )}
                  </div>
                  <p>{o.text}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
