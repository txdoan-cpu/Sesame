/** Shared class names (kept out of "use client" files so server components can import them). */

export const inputClass =
  "min-h-11 rounded-lg border-2 border-zinc-400 bg-white px-3 text-base text-zinc-900 focus:border-blue-700 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";

export const cardClass = "flex flex-col gap-3 rounded-xl border-2 border-zinc-300 p-4 dark:border-zinc-700";

export const buttonClass = "min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-60";

export const secondaryButtonClass = "min-h-11 rounded-lg border-2 border-current px-4 font-medium";

export const linkClass = "inline-flex min-h-11 items-center font-medium underline";

/** Replaces {name} placeholders in a message. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

/** "2027-06-30" -> "June 30, 2027" (en-CA) or "30 tháng 6, 2027" (vi). Dates are calendar days, so read them in UTC. */
export function longDate(isoDate: string, lang: "en" | "vi" = "en"): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(lang === "vi" ? "vi-VN" : "en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
