/**
 * Token estimation.
 *
 * The rule of thumb is about four characters per token for English prose. It
 * is an estimate, not a tokenizer, and the UI labels it as one. The same rule
 * is used by the Python converter and the MCP server, so the three numbers
 * always agree.
 *
 * Non-ASCII text is charged extra: CJK characters and emoji routinely take two
 * or three tokens each, so a plain character count would understate them.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let chars = 0;
  let nonAscii = 0;

  for (const character of text) {
    chars += 1;
    if (character.codePointAt(0)! > 127) nonAscii += 1;
  }

  return Math.max(1, Math.ceil(chars / 4 + nonAscii * 0.5));
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

/** Percentage saved, never negative and never above 100. */
export function savedPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((before - after) / before) * 100)));
}
