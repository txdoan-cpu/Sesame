/**
 * Reads a learner's typed (or spoken) numeric answer. Client-safe: no mathjs.
 * Accepts "5", "x = 5", "x=−4", "-4", "5.5", "5,5", "11/2", "minus 4", "negative four".
 */

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

export function parseNumericAnswer(input: string): number | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;

  text = text
    .replace(/[−–]/g, "-")
    .replace(/^[a-z]\s*(=|is|equals)\s*/, "")
    .replace(/^(it'?s|the answer is)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  let sign = 1;
  const negWord = text.match(/^(minus|negative)\s+(.*)$/);
  if (negWord) {
    sign = -1;
    text = negWord[2];
  }

  if (text in WORDS) return sign * WORDS[text];

  const fraction = text.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    return den === 0 ? null : sign * (Number(fraction[1]) / den);
  }

  const number = text.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(number)) return null;
  return sign * Number(number);
}

export function answerMatches(input: string, expected: number): boolean {
  const value = parseNumericAnswer(input);
  return value !== null && Math.abs(value - expected) < 1e-9;
}
