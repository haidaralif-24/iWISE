/**
 * Building the prompt that goes into the chat box.
 */

/** Collapses layout whitespace that survives the conversion. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type PromptPart = {
  name: string;
  text: string;
};

/**
 * Merges several documents into one prompt, each under a heading so the model
 * can tell them apart.
 */
export function mergeParts(parts: PromptPart[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].text;

  return parts
    .map((part, index) => {
      const heading = `## ${index + 1}. ${part.name}`;
      return `${heading}\n\n${part.text}`;
    })
    .join("\n\n---\n\n");
}

/** The header Pip puts above a prompt so the model knows what it is looking at. */
export function promptHeader(parts: PromptPart[]): string {
  if (parts.length === 0) return "";
  const list = parts.map((part) => `- ${part.name}`).join("\n");
  return `Here ${parts.length === 1 ? "is" : "are"} the document${parts.length === 1 ? "" : "s"} I asked Pip to attach.\n\n${list}\n\n`;
}

/** A safe file name for a note. */
export function slugify(text: string): string {
  return (
    text
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "note"
  );
}
