import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { llmConfigured, llmGenerate } from "@/lib/llm";

/**
 * Text extraction for teacher materials (CLAUDE.md §7.7): PDF, plain text,
 * images (transcribed by the LLM) and web pages. Never throws: returns an
 * empty string with a note when nothing could be read.
 */

export const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MATERIAL_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "text/csv"] as const;

export type Extracted = { text: string; note: string | null };

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function imageText(bytes: Uint8Array, mimeType: string): Promise<Extracted> {
  if (!llmConfigured()) return { text: "", note: "AI not connected yet: image text could not be read." };
  const r = await llmGenerate({
    system: "You transcribe teaching materials. Reply with the text only.",
    user: "Transcribe all text and mathematics in this image, in reading order. Write equations in plain text, like 3x + 4 = 19.",
    images: [{ mimeType, base64: Buffer.from(bytes).toString("base64") }],
    maxTokens: 2000,
    json: false,
    timeoutMs: 30_000,
  });
  return r.ok ? { text: r.text, note: null } : { text: "", note: `Image text could not be read (${r.code}).` };
}

/** Very small HTML-to-text: drop scripts, styles and tags, keep paragraphs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export async function extractFromFile(bytes: Uint8Array, mimeType: string): Promise<Extracted> {
  try {
    if (mimeType === "application/pdf") {
      const text = await pdfText(bytes);
      return text.trim() ? { text, note: null } : { text: "", note: "The PDF has no readable text (it may be a scan)." };
    }
    if (mimeType.startsWith("image/")) return imageText(bytes, mimeType);
    if (mimeType.startsWith("text/")) return { text: new TextDecoder().decode(bytes), note: null };
    return { text: "", note: `Unsupported file type ${mimeType}.` };
  } catch {
    return { text: "", note: "The file could not be read." };
  }
}

/**
 * Blocks addresses inside private networks, so a URL cannot make the server
 * reach internal services. Hostname-based: good enough for a demo.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

export async function extractFromUrl(raw: string): Promise<Extracted & { mimeType: string | null }> {
  if (!isPublicHttpUrl(raw)) return { text: "", note: "Only public http(s) links can be read.", mimeType: null };
  try {
    const res = await fetch(raw, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "SesameDemo/1.0 (material review)" } });
    if (!res.ok) return { text: "", note: `The link returned HTTP ${res.status}.`, mimeType: null };
    if (!isPublicHttpUrl(res.url)) return { text: "", note: "The link redirected to a private address.", mimeType: null };
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_MATERIAL_BYTES) return { text: "", note: "The linked file is larger than 10 MB.", mimeType: null };
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_MATERIAL_BYTES) return { text: "", note: "The linked file is larger than 10 MB.", mimeType: type };
    if (type === "text/html" || type === "application/xhtml+xml") {
      return { text: htmlToText(new TextDecoder().decode(bytes)), note: null, mimeType: type };
    }
    return { ...(await extractFromFile(bytes, type || "text/plain")), mimeType: type };
  } catch {
    return { text: "", note: "The link could not be fetched.", mimeType: null };
  }
}
