import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm } from "@tauri-apps/plugin-dialog";

import Documents from "./Documents";
import Launcher from "./Launcher";
import Notes from "./Notes";
import Pomodoro from "./Pomodoro";
import type { AuditEntry, PendingApproval } from "./lib/types";
import "./App.css";

type HotkeyStatus = {
  hotkey: string;
  registered: boolean;
  error: string | null;
};

const CHAT_SITES = [
  { name: "Claude", url: "https://claude.ai" },
  { name: "Le Chat", url: "https://chat.mistral.ai" },
  { name: "ChatGPT", url: "https://chatgpt.com" },
];

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "timer", label: "Timer" },
  { id: "docs", label: "Docs" },
  { id: "notes", label: "Notes" },
  { id: "apps", label: "Apps" },
  { id: "log", label: "Log" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function describeArguments(args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return args;
  try {
    const text = JSON.stringify(args, null, 2);
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return String(args);
  }
}

function App() {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [url, setUrl] = useState(CHAT_SITES[0].url);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);
  const [tab, setTab] = useState<TabId>("chat");
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    invoke<HotkeyStatus>("hotkey_status")
      .then(setStatus)
      .catch((err) => setError(String(err)));
  }, []);

  // The audit log is read from disk, so it is refreshed when the tab is open.
  useEffect(() => {
    if (tab !== "log") return;
    const load = () =>
      invoke<string[]>("audit_log", { limit: 100 })
        .then((lines) =>
          setAudit(
            lines
              .map((line) => {
                try {
                  return JSON.parse(line) as AuditEntry;
                } catch {
                  return null;
                }
              })
              .filter((entry): entry is AuditEntry => entry !== null),
          ),
        )
        .catch(() => setAudit([]));

    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [tab]);

  // Watch for tool calls that are waiting for the user's approval.
  const handled = useRef<Set<string>>(new Set());

  const checkApprovals = useCallback(async () => {
    let pending: PendingApproval[] = [];
    try {
      pending = await invoke<PendingApproval[]>("pending_approvals");
    } catch {
      return;
    }

    for (const request of pending) {
      if (handled.current.has(request.id)) continue;
      handled.current.add(request.id);

      // Bring Pip forward so the user sees what they are approving.
      try {
        const window = getCurrentWindow();
        await window.show();
        await window.setFocus();
      } catch {
        /* the window may already be in front */
      }

      let approved = false;
      try {
        // The plugin's confirm dialog has no separate detail field, so the
        // arguments are appended to the message.
        const detail = describeArguments(request.arguments);
        approved = await confirm(
          detail ? `${request.reason}\n\n${detail}` : request.reason,
          {
            title: `Pip wants to run ${request.tool}`,
            kind: "warning",
          },
        );
      } catch {
        approved = false;
      }

      try {
        await invoke("answer_approval", { id: request.id, approved });
      } catch (err) {
        setError(String(err));
      }
    }
  }, []);

  useEffect(() => {
    // Check straight away: an approval that arrived while the app was closed
    // should not wait a full interval to be noticed.
    void checkApprovals();
    const timer = setInterval(() => void checkApprovals(), 1200);
    return () => clearInterval(timer);
  }, [checkApprovals]);

  // Drag and drop is handled here rather than in the Documents tab, because the
  // user may be on another tab when the file lands — the tab has to switch
  // *and* the file has to reach the converter.
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{ paths: string[]; id: number } | null>(null);

  // Stable, so the Documents effect does not re-run on every render.
  const clearDropped = useCallback(() => setDropped(null), []);

  useEffect(() => {
    const webview = getCurrentWebview();
    let unlisten: (() => void) | undefined;

    webview
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (event.payload.type === "drop") {
          setDragging(false);
          setDropped({ paths: event.payload.paths, id: Date.now() });
          setTab("docs");
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => unlisten?.();
  }, []);

  async function openChat(target = url) {
    setError(null);
    try {
      await invoke("open_chat", { url: target });
    } catch (err) {
      setError(String(err));
    }
  }

  async function togglePin() {
    const next = !pinned;
    await getCurrentWindow().setAlwaysOnTop(next);
    setPinned(next);
  }

  return (
    <div className="shell">
      <header className="titlebar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          Pip
        </span>
        <div className="controls">
          <button
            className={pinned ? "icon on" : "icon"}
            onClick={togglePin}
            title={pinned ? "Unpin from top" : "Keep on top"}
          >
            ⌖
          </button>
          <button className="icon" onClick={() => getCurrentWindow().minimize()} title="Minimise">
            –
          </button>
          <button className="icon" onClick={() => getCurrentWindow().close()} title="Close">
            ×
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? "tab on" : "tab"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main className="body">
        {tab === "chat" && (
          <>
            <section className="card">
              <h2>Chat window</h2>
              <p className="muted">
                Opens the site in a separate window with no Tauri permissions. Sign in with{" "}
                <strong>email and password</strong> — Google blocks sign-in inside embedded windows.
              </p>
              <div className="sites">
                {CHAT_SITES.map((site) => (
                  <button
                    key={site.name}
                    onClick={() => {
                      setUrl(site.url);
                      void openChat(site.url);
                    }}
                  >
                    {site.name}
                  </button>
                ))}
              </div>
              <input
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                spellCheck={false}
                placeholder="https://…"
              />
              <button className="primary" onClick={() => void openChat()}>
                Open chat window
              </button>
            </section>

            <section className="card">
              <h2>Summon hotkey</h2>
              {status === null && <p className="muted">Checking…</p>}
              {status && status.registered && (
                <p className="ok">
                  <code>{status.hotkey}</code> registered — press it to show or hide this window.
                </p>
              )}
              {status && !status.registered && (
                <p className="bad">
                  Not registered. Another app may own this combo.
                  <span className="detail">{status.error ?? "unknown error"}</span>
                </p>
              )}
            </section>
          </>
        )}

        {tab === "timer" && <Pomodoro />}
        {tab === "docs" && (
          <Documents
            dragging={dragging}
            dropped={dropped}
            onDroppedHandled={clearDropped}
          />
        )}
        {tab === "notes" && <Notes />}
        {tab === "apps" && <Launcher />}

        {tab === "log" && (
          <section className="card">
            <div className="timer-head">
              <h2>Tool audit log</h2>
              <span className="pill">{audit.length}</span>
            </div>
            <p className="muted">
              Every tool call the AI makes, with what was allowed and what you approved.
            </p>
            {audit.length === 0 && <p className="muted">Nothing recorded yet.</p>}
            <ul className="audit">
              {audit.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`} className="auditrow">
                  <div className="audithead">
                    <span className="audittool">{entry.tool}</span>
                    <span
                      className={
                        entry.approved === true
                          ? "tag ok"
                          : entry.approved === false
                            ? "tag bad"
                            : entry.allowed
                              ? "tag"
                              : "tag bad"
                      }
                    >
                      {entry.approved === true
                        ? "approved"
                        : entry.approved === false
                          ? "declined"
                          : entry.allowed
                            ? "allowed"
                            : "refused"}
                    </span>
                    <span className="muted">{entry.timestamp.slice(11, 19)}</span>
                  </div>
                  {entry.reason && <span className="detail">{entry.reason}</span>}
                  <pre className="auditargs">{describeArguments(entry.arguments)}</pre>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="bad">{error}</p>}

        <footer className="foot">
          <span>Pip — a floating window for the AI you already use</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
