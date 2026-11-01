// What a cell may hold. Anything refused here would make Excel repair (and drop) content, or
// produce XML no reader accepts.

const MAX_TEXT = 32_767;
const MAX_FORMULA = 8_192;
// Characters XML 1.0 forbids, and unpaired surrogates.
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|\p{Cs}/u;

/** Formula text (without "=") that is at least structurally sound: balanced, non-empty. */
function formulaProblem(text: string): string | null {
  if (!text.trim() || text.startsWith("=")) {
    return "This formula is empty or malformed.";
  }
  let depth = 0;
  let quote: string | null = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth < 0) {
      return "This formula has an unmatched “)”.";
    }
  }
  if (quote) return "This formula has an unclosed quote.";
  if (depth) return "This formula has an unclosed “(”.";
  return null;
}

/** A message explaining why `input` cannot be stored in a cell, or null. */
export function inputProblem(input: string): string | null {
  if (ILLEGAL.test(input)) {
    return "Cells cannot contain control characters.";
  }
  if (input.startsWith("=") && input.length > 1) {
    return input.length - 1 > MAX_FORMULA
      ? `Formulas are limited to ${MAX_FORMULA} characters.`
      : formulaProblem(input.slice(1));
  }
  return input.length > MAX_TEXT ? `Cells hold at most ${MAX_TEXT} characters.` : null;
}
