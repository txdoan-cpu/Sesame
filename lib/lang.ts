import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "./i18n";

/** Reads the parent's language choice. Request-time data: call inside a Suspense boundary. */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}
