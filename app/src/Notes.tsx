import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

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
 * read from disk so the user can see exactly what was saved.
 */
export default function Notes() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    invoke<NoteFile[]>("list_notes")
      .then(setFiles)
      .catch((err) => setError(String(err)));
  }, []);

  function add() {
    const text = draft.trim();
    if (!text) return;
    setTodos((previous) => [
      { id: `${Date.now()}`, text, done: false, createdAt: new Date().toISOString() },
      ...previous,
    ]);
    setDraft("");
  }

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
            title={`Open ${file.path}`}
            onClick={() => {
              void openPath(file.path).catch((err) => setError(String(err)));
            }}
          >
            <span className="notename">{file.name}</span>
            <span className="muted">{file.preview}</span>
          </button>
        ))}
      </div>

      {error && <p className="bad">{error}</p>}
    </section>
  );
}
