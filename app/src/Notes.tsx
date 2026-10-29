import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import DOMPurify from "dompurify";

import type { NoteFile } from "./lib/types";

type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

const TODOS_KEY = "pip.todos";

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(TODOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Todo =>
        typeof item?.text === "string" && typeof item?.done === "boolean",
    );
  } catch {
    return [];
  }
}

/**
 * Two kinds of notes live here.
 *
 * The to-do list is the user's own and stays in local storage. The notes
 * folder is what the AI writes to through the `create_note` tool, and it is
 * read from disk so the user can see exactly what was saved — and change it
 * without leaving the window.
 */
export default function Notes() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [open, setOpen] = useState<NoteFile | null>(null);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }, [todos]);

  const refresh = useCallback(async () => {
    try {
      setFiles(await invoke<NoteFile[]>("list_notes"));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function add() {
    const text = draft.trim();
    if (!text) return;
    setTodos((previous) => [
      { id: `${Date.now()}`, text, done: false, createdAt: new Date().toISOString() },
      ...previous,
    ]);
    setDraft("");
  }

  async function openNote(file: NoteFile) {
    try {
      const text = await invoke<string>("read_note", { path: file.path });
      setOpen(file);
      setBody(text);
      setSaved(text);
      setError(null);
      setNotice(null);
    } catch (err) {
      setError(String(err));
    }
  }

  const save = useCallback(async () => {
    if (!open) return;
    setSaving(true);
    try {
      await invoke("save_note", { path: open.path, text: body });
      setSaved(body);
      setNotice("Saved");
      setError(null);
      void refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [open, body, refresh]);

  // ⌘S saves while a note is open, so editing does not need a mouse.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, save]);

  /**
   * Rendered Markdown, sanitised. A note is written by the model, and this
   * window can call Tauri commands, so an unsanitised renderer would turn a
   * note into code execution rather than a dirty page.
   */
  const rendered = useMemo(() => {
    if (!body.trim()) return "";
    const html = marked.parse(body, { async: false }) as string;
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ["img", "iframe", "object", "embed", "style", "link", "form", "input"],
      FORBID_ATTR: ["style", "srcset", "ping"],
    });
  }, [body]);

  const dirty = open !== null && body !== saved;
  const remaining = useMemo(() => todos.filter((todo) => !todo.done).length, [todos]);

  return (
    <section className="card">
      <div className="timer-head">
        <h2>Notes</h2>
        <span className="pill">{remaining} open</span>
      </div>

      <div className="todo-add">
        <input
          value={draft}
          placeholder="Write a note, press Enter"
          spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <button onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>

      {todos.length === 0 && <p className="muted">Nothing on the list yet.</p>}

      <ul className="todos">
        {todos.map((todo) => (
          <li key={todo.id} className={todo.done ? "todo done" : "todo"}>
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() =>
                setTodos((previous) =>
                  previous.map((item) =>
                    item.id === todo.id ? { ...item, done: !item.done } : item,
                  ),
                )
              }
            />
            <span onClick={() =>
              setTodos((previous) =>
                previous.map((item) =>
                  item.id === todo.id ? { ...item, done: !item.done } : item,
                ),
              )
            }>
              {todo.text}
            </span>
            <button
              className="x"
              title="Delete"
              onClick={() => setTodos((previous) => previous.filter((item) => item.id !== todo.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {open === null ? (
        <div className="notes-split">
          <h3 className="subhead">Saved by the AI</h3>
          {files.length === 0 && (
            <p className="muted">
              Nothing yet. Ask the chat to save a note and it will ask you first.
            </p>
          )}
          {files.map((file) => (
            <button
              key={file.path}
              className="notefile"
              title={`Open ${file.name}`}
              onClick={() => void openNote(file)}
            >
              <span className="notename">{file.name}</span>
              <span className="muted">{file.preview}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="note-reader">
          <div className="note-head">
            <button className="link" onClick={() => setOpen(null)} title="Back to the list">
              ← back
            </button>
            <span className="notename" title={open.path}>
              {open.name}
            </span>
            <span className="note-actions">
              <button
                className="link"
                title="Open in your editor"
                onClick={() => void openPath(open.path).catch((err) => setError(String(err)))}
              >
                ↗
              </button>
              <button className="link" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "saving…" : dirty ? "save" : "saved"}
              </button>
            </span>
          </div>

          <div className="note-split">
            <div className="md" dangerouslySetInnerHTML={{ __html: rendered }} />
            <textarea
              className="editor"
              value={body}
              spellCheck={false}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
          </div>
          <p className="muted">Rendered above, source below. ⌘S saves.</p>
        </div>
      )}

      {error && <p className="bad">{error}</p>}
      {notice && <p className="ok">{notice}</p>}
    </section>
  );
}
