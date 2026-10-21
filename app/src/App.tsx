import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Pomodoro from "./Pomodoro";
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

function App() {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [url, setUrl] = useState(CHAT_SITES[0].url);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    invoke<HotkeyStatus>("hotkey_status")
      .then(setStatus)
      .catch((err) => setError(String(err)));
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

      <main className="body">
        <Pomodoro />

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
                  openChat(site.url);
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
          <button className="primary" onClick={() => openChat()}>
            Open chat window
          </button>
        </section>

        {error && <p className="bad">{error}</p>}

        <footer className="foot">
          <span>Day 1 spike — window, hotkey, chat login</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
