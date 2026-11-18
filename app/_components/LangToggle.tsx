import { setLang } from "@/app/(auth)/actions";
import type { Lang } from "@/lib/i18n";

type Props = { current: Lang; labels: { label: string; en: string; vi: string } };

/** EN / VI switch for parent-facing pages. Stores the choice in a cookie. */
export function LangToggle({ current, labels }: Props) {
  return (
    <form action={setLang} className="flex items-center gap-2" aria-label={labels.label}>
      {(["en", "vi"] as const).map((lang) => (
        <button
          key={lang}
          type="submit"
          name="lang"
          value={lang}
          aria-pressed={current === lang}
          lang={lang}
          className={`min-h-11 rounded-lg border-2 px-4 text-base font-medium ${
            current === lang ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-400"
          }`}
        >
          {labels[lang]}
        </button>
      ))}
    </form>
  );
}
