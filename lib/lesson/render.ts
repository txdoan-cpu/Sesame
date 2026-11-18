import "server-only";
import katex from "katex";
import { toTex } from "@/lib/math/check";

/**
 * Renders lesson text on the server so the browser gets ready HTML and does
 * not need mathjs or KaTeX's JavaScript. Supports a small Markdown subset:
 * paragraphs, "- " bullet lists, **bold**, and $math$ (ASCII, see lib/math).
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One equation or expression as KaTeX HTML (with MathML for screen readers). */
export function mathHtml(ascii: string): string {
  return katex.renderToString(toTex(ascii), { throwOnError: false, output: "htmlAndMathml" });
}

const DOLLAR = "\u0000";

/** Inline text: escapes HTML, then **bold** and $math$. Write money as \$4. */
export function inlineHtml(text: string): string {
  return text
    .replace(/\\\$/g, DOLLAR)
    .split(/(\$[^$]+\$)/g)
    .map((part) => {
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) return mathHtml(part.slice(1, -1));
      return escapeHtml(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    })
    .join("")
    .replaceAll(DOLLAR, "$");
}

/** Plain text for speech or captions: drops the $ math markers and ** bold. */
export function plainText(text: string): string {
  return text.replace(/\\\$/g, DOLLAR).replace(/\$([^$]+)\$/g, "$1").replace(/\*\*/g, "").replaceAll(DOLLAR, "$");
}

/** Block text: blank lines separate paragraphs; consecutive "- " lines form a list. */
export function blockHtml(md: string): string {
  return md
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim());
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${inlineHtml(l.slice(2))}</li>`).join("")}</ul>`;
      }
      return `<p>${inlineHtml(lines.join(" "))}</p>`;
    })
    .join("");
}
