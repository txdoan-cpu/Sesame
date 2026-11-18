import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import vi from "@/messages/vi.json";
import { PARENT_NAMESPACES, parentMessages, parseLang } from "@/lib/i18n";

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("parent strings", () => {
  it("vi.json has every parent-facing key that en.json has", () => {
    for (const ns of PARENT_NAMESPACES) {
      expect(keys(vi[ns]).sort(), ns).toEqual(keys(en[ns]).sort());
    }
  });

  it("falls back to English for unknown languages", () => {
    expect(parseLang("fr")).toBe("en");
    expect(parseLang(undefined)).toBe("en");
    expect(parentMessages(parseLang("vi")).auth.logout).toBe(vi.auth.logout);
  });
});
