/**
 * Safety screen for learner questions (CLAUDE.md §7.2).
 * Runs before any model call and does not depend on the model. If a question
 * suggests self-harm, abuse, bullying or danger, the lesson stops, the
 * learner sees a calm, supportive message, and the parent gets a locked,
 * always-shared `safety` notification.
 *
 * Patterns lean towards catching too much: a false alarm costs a short pause;
 * a miss could cost much more.
 */

export type SafetyCategory = "self_harm" | "abuse" | "bullying" | "danger" | "other_concern";

const PATTERNS: Record<Exclude<SafetyCategory, "other_concern">, RegExp[]> = {
  self_harm: [
    /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting)\s+my\s?self\b/,
    /\bsuicid(e|al)\b/,
    /\b(want|wanna|going|gonna)\s+(to\s+)?die\b/,
    /\bend\s+(my|it\s+all)\b.*\blife\b|\bend\s+it\s+all\b/,
    /\b(don'?t|do\s+not)\s+want\s+to\s+(be\s+alive|live|exist)\b/,
    /\bbetter\s+off\s+dead\b/,
    /\bno\s+(reason|point)\s+(to|in)\s+liv(e|ing)\b/,
  ],
  abuse: [
    /\babus(e|ed|es|ing|ive)\b/,
    /\b(hits|hit|beats|beat|kicks|slaps|chokes|hurts)\s+me\b/,
    /\btouch(ed|es|ing)?\s+me\b/,
    /\b(scared|afraid|frightened)\s+(to\s+go|of\s+going)\s+home\b/,
    /\b(scared|afraid)\s+of\s+my\s+(dad|mom|mum|father|mother|step\w*|uncle|brother|sister|parents?)\b/,
  ],
  bullying: [
    /\bbull(y|ied|ies|ying)\b/,
    /\bpick(s|ed|ing)?\s+on\s+me\b/,
    /\b(make|makes|made)\s+fun\s+of\s+me\b/,
    /\beveryone\s+hates\s+me\b/,
    /\bthreaten(s|ed|ing)?\s+me\b/,
  ],
  danger: [
    /\b(has|have|got|bring|brought|bringing)\s+a\s+(gun|knife|weapon)\b/,
    /\b(going|gonna|want)\s+to\s+(hurt|kill|shoot|stab)\s+(him|her|them|someone|somebody|people)\b/,
    /\b(someone|somebody|a\s+stranger|a\s+man|a\s+guy)\s+(is\s+)?follow(ing|ed|s)\s+me\b/,
    /\b(i'?m|i\s+am)\s+not\s+safe\b|\bi\s+(don'?t|do\s+not)\s+feel\s+safe\b|\bnot\s+safe\s+(at|in)\s+home\b/,
    /\brun(ning)?\s+away\s+from\s+home\b/,
  ],
};

/** Lowercases, straightens quotes and collapses spaces so patterns match typed or spoken text. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
}

export function screenQuestion(question: string): { flagged: boolean; category: SafetyCategory | null } {
  const text = normalise(question);
  for (const [category, patterns] of Object.entries(PATTERNS) as [Exclude<SafetyCategory, "other_concern">, RegExp[]][]) {
    if (patterns.some((p) => p.test(text))) return { flagged: true, category };
  }
  return { flagged: false, category: null };
}

/**
 * Shown (and spoken) to the learner. Calm, plain words, points to a trusted
 * adult and Kids Help Phone (Canada, free, 24/7).
 */
export const SAFETY_MESSAGE =
  "Thank you for telling me. That sounds really hard, and you deserve to feel safe. " +
  "I am only a math helper, so please talk to a trusted adult right now, like a parent, a teacher or your school counsellor. " +
  "You can also call Kids Help Phone at 1-800-668-6868, or text CONNECT to 686868, any time, day or night.";

/**
 * Who hears about a safety event (owner decision, Round 4):
 * possible abuse is NOT sent to the parent, who could be the source of harm;
 * it is recorded for a responsible adult to review. Everything else notifies
 * the linked parents (locked, always shared).
 */
export function safetyRoute(category: SafetyCategory): "notify_parent" | "review_only" {
  return category === "abuse" ? "review_only" : "notify_parent";
}

/** For possible abuse, do not point the learner back to a parent. */
export const SAFETY_MESSAGE_ABUSE =
  "Thank you for telling me. That sounds really hard, and you deserve to feel safe. " +
  "I am only a math helper, so please talk to an adult you trust, like a teacher or your school counsellor. " +
  "You can also call Kids Help Phone at 1-800-668-6868, or text CONNECT to 686868, any time, day or night.";

export function safetyMessage(category: SafetyCategory): string {
  return category === "abuse" ? SAFETY_MESSAGE_ABUSE : SAFETY_MESSAGE;
}
