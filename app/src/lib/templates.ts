/**
 * Prompt templates.
 *
 * A template is a reusable instruction that goes above the document — the
 * thing the user would otherwise type into the chat box every time. Built-in
 * ones cover the common study jobs; the user can save their own, which are
 * kept in local storage alongside the Pomodoro settings.
 */

export type Template = {
  id: string;
  name: string;
  prompt: string;
  /** Built-in templates cannot be deleted, only overridden. */
  builtin: boolean;
};

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "summarise",
    name: "Summarise this",
    prompt: "Summarise this document for me. Give me the key points as short bullet points.",
    builtin: true,
  },
  {
    id: "study-notes",
    name: "Turn into study notes",
    prompt:
      "Turn this document into study notes. Use headings, keep the formulas, and list anything I should be able to explain from memory.",
    builtin: true,
  },
  {
    id: "explain-simple",
    name: "Explain it simply",
    prompt:
      "Explain this document in simple language, as if explaining it to a smart beginner. Keep the structure of the original.",
    builtin: true,
  },
  {
    id: "key-ideas",
    name: "Pull out the key ideas",
    prompt:
      "Pull out the key ideas, definitions and formulas from this document. Skip the worked examples.",
    builtin: true,
  },
  {
    id: "quiz",
    name: "Quiz me on this",
    prompt:
      "Quiz me on this document. Ask one question at a time, wait for my answer, then tell me whether I was right.",
    builtin: true,
  },
  {
    id: "exam-questions",
    name: "Make exam questions",
    prompt:
      "Write five exam-style questions from this document, with the answers underneath each one.",
    builtin: true,
  },
];

const CUSTOM_KEY = "pip.templates";

export function loadCustomTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Template =>
          typeof item?.name === "string" &&
          typeof item?.prompt === "string" &&
          typeof item?.id === "string",
      )
      .map((item) => ({ ...item, builtin: false }));
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: Template[]): void {
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify(templates.map(({ id, name, prompt }) => ({ id, name, prompt }))),
    );
  } catch {
    // A full or disabled local storage must not break the app.
  }
}

export function allTemplates(custom: Template[]): Template[] {
  return [...BUILTIN_TEMPLATES, ...custom];
}

/** A filesystem-safe id for a user-created template. */
export function templateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `custom-${slug || "template"}-${Date.now().toString(36)}`;
}
