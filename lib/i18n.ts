import en from "@/messages/en.json";
import vi from "@/messages/vi.json";

export type Lang = "en" | "vi";
export const LANG_COOKIE = "lang";

/** Namespaces shown to parents; these must exist in both en.json and vi.json. */
export const PARENT_NAMESPACES = ["app", "health", "lang", "auth", "parent", "portal"] as const;
type ParentMessages = Pick<typeof en, (typeof PARENT_NAMESPACES)[number]>;

const viParent: ParentMessages = vi;

export function parseLang(value: string | undefined): Lang {
  return value === "vi" ? "vi" : "en";
}

/** Parent-facing strings in the chosen language. */
export function parentMessages(lang: Lang): ParentMessages {
  return lang === "vi" ? viParent : en;
}

/** Learner-facing strings are English (Canada) only. */
export const learnerMessages = en.learner;
