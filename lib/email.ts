import "server-only";

/**
 * Parent email (Resend). In-app notifications come first (§3); email is sent
 * only when RESEND_API_KEY is set, and never to the reserved test domains.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<"sent" | "skipped" | "failed"> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "Sesame demo <onboarding@resend.dev>";
  if (!key || /@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(msg.to)) return "skipped";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
