import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type SharedFolder = {
  path: string;
  /** The notes folder is always shared, because the AI writes notes there. */
  always: boolean;
  /** False when the folder was granted but has since been moved or deleted. */
  present: boolean;
};

/** `/Users/sam/Documents/x` -> `~/Documents/x`. The full path is in the tooltip. */
function shorten(path: string): string {
  const unix = path.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (unix) return `~${unix[1] ?? ""}`;
  const win = path.match(/^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/);
  if (win) return `~${(win[1] ?? "").replace(/\\/g, "/")}`;
  return path;
}

/**
 * Folder access.
 *
 * The AI can read documents in the folders listed here and nowhere else. The
 * list lives in `~/.pip/allowlist.json`, which the MCP server reads on every
 * tool call, so adding or removing a folder takes effect immediately — the
 * server does not have to be restarted.
 */
function Access() {
  const [folders, setFolders] = useState<SharedFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setFolders(await invoke<SharedFolder[]>("shared_folders"));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The file can change underneath us — a second window, or a hand edit.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function addFolder() {
    setError(null);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Share a folder with the AI",
      });
      if (typeof picked !== "string") return;

      setBusy(true);
      setFolders(await invoke<SharedFolder[]>("add_shared_folder", { path: picked }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeFolder(path: string) {
    setError(null);
    try {
      setBusy(true);
      setFolders(await invoke<SharedFolder[]>("remove_shared_folder", { path }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const granted = folders.filter((folder) => !folder.always).length;

  return (
    <section className="card">
      <div className="timer-head">
        <h2>Folder access</h2>
        <span className="pill">{granted === 0 ? "nothing shared" : `${granted} shared`}</span>
      </div>

      <p className="muted">
        The AI can read documents in these folders, and nowhere else. Nothing is shared until you add
        it here.
      </p>

      <ul className="folders">
        {folders.map((folder) => (
          <li
            key={folder.path}
            className={folder.present ? "folderrow" : "folderrow missing"}
          >
            <div className="folderinfo">
              <span className="folderpath" title={folder.path}>
                {shorten(folder.path)}
              </span>
              <span className="foldernote">
                {folder.always ? "notes · always shared" : folder.present ? "shared" : "missing"}
              </span>
            </div>

            {!folder.always && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void removeFolder(folder.path)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <button className="primary" disabled={busy} onClick={() => void addFolder()}>
        Add folder…
      </button>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

export default Access;
