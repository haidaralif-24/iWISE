import { useMemo, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

type Entry = {
  label: string;
  hint: string;
  kind: "app" | "folder" | "url";
  target: string;
};

const ENTRIES: Entry[] = [
  { label: "Finder", hint: "browse files", kind: "app", target: "/System/Library/CoreServices/Finder.app" },
  { label: "Mail", hint: "email", kind: "app", target: "/System/Applications/Mail.app" },
  { label: "Calendar", hint: "schedule", kind: "app", target: "/System/Applications/Calendar.app" },
  { label: "Notes", hint: "apple notes", kind: "app", target: "/System/Applications/Notes.app" },
  { label: "TextEdit", hint: "plain text", kind: "app", target: "/System/Applications/TextEdit.app" },
  { label: "Calculator", hint: "quick maths", kind: "app", target: "/System/Applications/Calculator.app" },
  { label: "Documents", hint: "folder", kind: "folder", target: "~/Documents" },
  { label: "Downloads", hint: "folder", kind: "folder", target: "~/Downloads" },
  { label: "Desktop", hint: "folder", kind: "folder", target: "~/Desktop" },
  { label: "Claude", hint: "chat", kind: "url", target: "https://claude.ai" },
  { label: "Le Chat", hint: "chat", kind: "url", target: "https://chat.mistral.ai" },
  { label: "ChatGPT", hint: "chat", kind: "url", target: "https://chatgpt.com" },
];

/**
 * A small launcher. It opens things with the opener plugin rather than
 * spawning processes, so there is nothing to sanitise here beyond the list.
 */
export default function Launcher() {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ENTRIES;
    return ENTRIES.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) || entry.hint.toLowerCase().includes(needle),
    );
  }, [query]);

  async function launch(entry: Entry) {
    setError(null);
    try {
      if (entry.kind === "url") {
        await openUrl(entry.target);
      } else {
        await openPath(entry.target);
      }
    } catch (err) {
      setError(`${entry.label}: ${String(err)}`);
    }
  }

  return (
    <section className="card">
      <div className="timer-head">
        <h2>Launcher</h2>
        <span className="pill">{matches.length}</span>
      </div>

      <input
        value={query}
        placeholder="Search apps and folders"
        spellCheck={false}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      <div className="launcher">
        {matches.map((entry) => (
          <button key={entry.label} className="launchrow" onClick={() => void launch(entry)}>
            <span className="launchlabel">{entry.label}</span>
            <span className="muted">{entry.hint}</span>
          </button>
        ))}
      </div>

      {matches.length === 0 && <p className="muted">Nothing matches that.</p>}
      {error && <p className="bad">{error}</p>}
    </section>
  );
}
