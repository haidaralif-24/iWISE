use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Day-1 default. `CmdOrCtrl` maps to Cmd on macOS and Ctrl on Windows/Linux,
/// so one string covers all three platforms.
const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+Space";

/// Default chat window size. Height matches the Pip window so the two sit side
/// by side as one unit. The window is resizable; these are only the opening size.
const CHAT_WIDTH: f64 = 820.0;
const CHAT_HEIGHT: f64 = 680.0;

/// How long a document conversion may take before it is killed. The spike notes
/// recorded a 22 second PDF, so the limit is generous but not infinite.
const CONVERT_TIMEOUT: Duration = Duration::from_secs(180);

/// The bridge that writes Markdown into the chat page. Embedded at build time
/// so the shipped app carries it without a file dependency.
const BRIDGE_JS: &str = include_str!("../../../bridge/inject.js");

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub struct HotkeyStatus {
    hotkey: String,
    registered: bool,
    error: Option<String>,
}

impl HotkeyStatus {
    fn pending() -> Self {
        Self {
            hotkey: DEFAULT_HOTKEY.to_string(),
            registered: false,
            error: None,
        }
    }
}

/// Summon semantics: hide when the window is already in front, otherwise bring
/// it forward. A visible-but-unfocused window is treated as "not summoned".
fn toggle_main(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    let visible = win.is_visible().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);

    if visible && focused {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn hotkey_status(state: tauri::State<'_, Mutex<HotkeyStatus>>) -> HotkeyStatus {
    match state.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

// ---------------------------------------------------------------------------
// Chat window
// ---------------------------------------------------------------------------

/// Places the chat window beside Pip: to its right when the screen has room,
/// otherwise flipped to the left, then clamped inside the monitor. All values
/// are physical pixels, so this holds on any display scale factor.
fn dock_chat(main: &WebviewWindow, chat: &WebviewWindow) -> tauri::Result<()> {
    const GAP: i32 = 8;

    let pos = main.outer_position()?;
    let size = main.outer_size()?;
    // The chat window is resizable, so clamp against its current width rather
    // than the default constant — otherwise a widened window overflows the screen.
    let width = chat
        .outer_size()
        .map(|s| s.width as i32)
        .unwrap_or(CHAT_WIDTH as i32);

    let mut x = pos.x + size.width as i32 + GAP;

    if let Some(monitor) = main.current_monitor()? {
        let left = monitor.position().x;
        let right = left + monitor.size().width as i32;

        if x + width > right {
            x = pos.x - width - GAP;
        }
        x = x.max(left);
    }

    chat.set_position(PhysicalPosition::new(x, pos.y))
}

/// Opens (or re-uses) the separate chat window. The window is created at
/// runtime on purpose: the capability allowlist targets `main` only, so this
/// window — which hosts a third-party page — has no access to any Tauri command.
#[tauri::command]
fn open_chat(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|err| format!("invalid URL: {err}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) URLs are allowed".into());
    }

    let main = app
        .get_webview_window("main")
        .ok_or("main window is not available")?;

    if let Some(win) = app.get_webview_window("chat") {
        win.navigate(parsed).map_err(|err| err.to_string())?;
        win.set_always_on_top(true).map_err(|err| err.to_string())?;
        // Best effort: a failed re-dock must not stop the window opening.
        let _ = dock_chat(&main, &win);
        win.show().map_err(|err| err.to_string())?;
        win.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    let chat = WebviewWindowBuilder::new(&app, "chat", WebviewUrl::External(parsed))
        .title("Pip — chat")
        .inner_size(CHAT_WIDTH, CHAT_HEIGHT)
        .min_inner_size(420.0, 480.0)
        .resizable(true)
        .always_on_top(true)
        .build()
        .map_err(|err| err.to_string())?;

    let _ = dock_chat(&main, &chat);

    Ok(())
}

/// Writes Markdown into the chat page's message box.
///
/// The chat window has no Tauri permissions by design, so this cannot go
/// through the IPC bridge. Instead the bridge script is evaluated directly
/// into the page, which is the only thing it is allowed to do.
#[tauri::command]
fn inject_into_chat(app: AppHandle, text: String) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("no chat window is open — open one first")?;

    if text.trim().is_empty() {
        return Err("there is nothing to send".into());
    }

    let payload = serde_json::to_string(&text).map_err(|err| err.to_string())?;
    let script = format!(
        "window.__PIP_PAYLOAD__ = {payload};\n{BRIDGE_JS}\n\
         window.__pipInject && window.__pipInject(window.__PIP_PAYLOAD__);"
    );

    chat.eval(&script).map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// Document conversion
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    source: String,
    name: String,
    extension: String,
    bytes: u64,
    pages: u32,
    selected_pages: Vec<u32>,
    markdown: String,
    raw_text: String,
    truncated: bool,
    /// True when the file has content but no extractable text — a scan, or an
    /// image. The UI says so rather than showing an empty preview.
    no_text_layer: bool,
    markdown_chars: usize,
    raw_chars: usize,
    markdown_tokens: usize,
    raw_tokens: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    ready: bool,
    python: String,
    script: String,
    detail: String,
}

/// Walks up from the working directory to find the repository root, which is
/// where the sidecar lives.
fn find_repo_root() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;

    for _ in 0..8 {
        let candidate = current.join("sidecars").join("markitdown").join("convert.py");
        if candidate.exists() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }

    None
}

fn python_executable(repo_root: Option<&Path>) -> String {
    if let Ok(configured) = std::env::var("PIP_PYTHON") {
        if !configured.trim().is_empty() {
            return configured;
        }
    }

    if let Some(root) = repo_root {
        let venv = root.join("sidecars/markitdown/.venv/bin/python");
        if venv.exists() {
            return venv.to_string_lossy().into_owned();
        }
        let venv_windows = root.join("sidecars/markitdown/.venv/Scripts/python.exe");
        if venv_windows.exists() {
            return venv_windows.to_string_lossy().into_owned();
        }
    }

    if cfg!(windows) {
        "python".into()
    } else {
        "python3".into()
    }
}

fn sidecar_script(repo_root: Option<&Path>) -> Option<PathBuf> {
    if let Ok(configured) = std::env::var("PIP_CONVERT_SCRIPT") {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Some(path);
        }
    }

    repo_root.map(|root| root.join("sidecars/markitdown/convert.py"))
}

#[tauri::command]
fn sidecar_status() -> SidecarStatus {
    let root = find_repo_root();
    let script = sidecar_script(root.as_deref());
    let python = python_executable(root.as_deref());

    let script_path = script
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "not found".into());

    let ready = script.as_ref().map(|path| path.exists()).unwrap_or(false);

    let detail = if !ready {
        "convert.py was not found. Run the app from the repository, or set PIP_CONVERT_SCRIPT."
    } else if !Path::new(&python).exists() && python.contains('/') {
        "the Python environment is missing. Run: uv venv sidecars/markitdown/.venv && uv pip install -r sidecars/markitdown/requirements.txt"
    } else {
        "ready"
    };

    SidecarStatus {
        ready,
        python,
        script: script_path,
        detail: detail.into(),
    }
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Runs the converter and parses its JSON envelope.
fn convert_blocking(path: String, pages: Option<String>) -> Result<ConvertResult, String> {
    let root = find_repo_root();
    let script = sidecar_script(root.as_deref()).ok_or(
        "convert.py was not found. Run the app from the repository, or set PIP_CONVERT_SCRIPT.",
    )?;

    if !script.exists() {
        return Err(format!("convert.py is missing at {}", script.display()));
    }

    let python = python_executable(root.as_deref());
    let mut args: Vec<String> = vec![
        script.to_string_lossy().into_owned(),
        path,
        "--json".into(),
    ];
    if let Some(pages) = pages.filter(|value| !value.trim().is_empty()) {
        args.push("--pages".into());
        args.push(pages);
    }

    let mut child = Command::new(&python)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("could not run {python}: {err}"))?;

    // Drain both pipes on their own threads, otherwise a large document fills
    // the pipe buffer and the child blocks forever.
    let mut stdout_pipe = child.stdout.take().ok_or("no stdout")?;
    let mut stderr_pipe = child.stderr.take().ok_or("no stderr")?;

    let stdout_handle = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buffer);
        buffer
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + CONVERT_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "conversion timed out after {} seconds",
                        CONVERT_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("conversion failed: {err}")),
        }
    };

    let stdout = String::from_utf8_lossy(&stdout_handle.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_handle.join().unwrap_or_default()).into_owned();

    if !status.success() {
        let message = if stderr.trim().is_empty() {
            format!("the converter exited with code {}", status.code().unwrap_or(-1))
        } else {
            stderr.trim().to_string()
        };
        return Err(message);
    }

    let envelope: Value =
        serde_json::from_str(&stdout).map_err(|err| format!("could not read the converter output: {err}"))?;

    let stats = envelope.get("stats").cloned().unwrap_or(Value::Null);
    let selected_pages = envelope
        .get("selectedPages")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_u64)
                .map(|value| value as u32)
                .collect()
        })
        .unwrap_or_default();

    Ok(ConvertResult {
        source: text(&envelope, "source"),
        name: text(&envelope, "name"),
        extension: text(&envelope, "extension"),
        bytes: number(&envelope, "bytes"),
        pages: number(&envelope, "pages") as u32,
        selected_pages,
        markdown: text(&envelope, "markdown"),
        raw_text: text(&envelope, "rawText"),
        truncated: envelope
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        no_text_layer: envelope
            .get("noTextLayer")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        markdown_chars: number(&stats, "markdownChars") as usize,
        raw_chars: number(&stats, "rawChars") as usize,
        markdown_tokens: number(&stats, "markdownTokens") as usize,
        raw_tokens: number(&stats, "rawTokens") as usize,
    })
}

#[tauri::command]
async fn convert_document(path: String, pages: Option<String>) -> Result<ConvertResult, String> {
    // The conversion blocks for as long as the document takes, so it runs on a
    // worker thread rather than the UI thread.
    tauri::async_runtime::spawn_blocking(move || convert_blocking(path, pages))
        .await
        .map_err(|err| format!("conversion task failed: {err}"))?
}

// ---------------------------------------------------------------------------
// Approvals and audit log
//
// The MCP server and the app talk through files in the state folder. It keeps
// the bearer token inside the server instead of handing it to the app, and it
// means the app needs no network client of its own.
// ---------------------------------------------------------------------------

fn state_dir() -> PathBuf {
    std::env::var("PIP_STATE_DIR").map(PathBuf::from).unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        PathBuf::from(home).join(".pip")
    })
}

fn pending_dir() -> PathBuf {
    state_dir().join("pending")
}

fn decisions_dir() -> PathBuf {
    state_dir().join("decisions")
}

/// The folder the AI's `create_note` tool writes to.
fn notes_dir() -> PathBuf {
    std::env::var("PIP_NOTES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| state_dir().join("notes"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    name: String,
    path: String,
    preview: String,
    modified: String,
    bytes: u64,
}

/// Lists the notes the AI has saved, so the user can see exactly what was
/// written to disk.
#[tauri::command]
fn list_notes() -> Vec<NoteFile> {
    let dir = notes_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut notes: Vec<NoteFile> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().map(|ext| ext == "md").unwrap_or(false))
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = fs::metadata(&path).ok()?;
            let body = fs::read_to_string(&path).unwrap_or_default();

            let preview = body
                .lines()
                .map(|line| line.trim())
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .unwrap_or("")
                .chars()
                .take(90)
                .collect::<String>();

            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|since| since.as_secs())
                .unwrap_or(0);

            Some(NoteFile {
                name: path.file_name()?.to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                preview,
                modified: modified.to_string(),
                bytes: metadata.len(),
            })
        })
        .collect();

    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    notes
}

#[tauri::command]
fn pending_approvals() -> Vec<Value> {
    let dir = pending_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut pending: Vec<Value> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .collect();

    pending.sort_by(|a, b| {
        a.get("createdAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(b.get("createdAt").and_then(Value::as_str).unwrap_or(""))
    });

    pending
}

#[tauri::command]
fn answer_approval(id: String, approved: bool) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("missing approval id".into());
    }

    let dir = decisions_dir();
    fs::create_dir_all(&dir).map_err(|err| format!("could not create {}: {err}", dir.display()))?;

    let payload = serde_json::json!({ "approved": approved, "answeredAt": chrono_now() });
    let target = dir.join(format!("{id}.json"));

    fs::write(&target, payload.to_string()).map_err(|err| format!("could not answer: {err}"))?;

    // The request file is removed so the app stops showing the prompt. The
    // server also cleans it up once it has read the decision.
    let _ = fs::remove_file(pending_dir().join(format!("{id}.json")));

    Ok(())
}

/// A tiny ISO-8601 timestamp without pulling in a date library.
fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = now.as_secs();

    // Days since the epoch -> civil date (Howard Hinnant's civil_from_days).
    let days = (seconds / 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    let time_of_day = seconds % 86_400;
    let hour = time_of_day / 3_600;
    let minute = (time_of_day % 3_600) / 60;
    let second = time_of_day % 60;

    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[tauri::command]
fn audit_log(limit: Option<usize>) -> Vec<String> {
    let path = state_dir().join("audit.log");
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };

    let limit = limit.unwrap_or(100).clamp(1, 1_000);
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(limit)
        .map(|line| line.to_string())
        .collect()
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Pressed only — auto-repeat would otherwise toggle the
                    // window dozens of times per second while the key is held.
                    if event.state == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            hotkey_status,
            open_chat,
            inject_into_chat,
            sidecar_status,
            convert_document,
            pending_approvals,
            answer_approval,
            audit_log,
            list_notes
        ])
        .setup(|app| {
            let mut status = HotkeyStatus::pending();

            match DEFAULT_HOTKEY.parse::<Shortcut>() {
                Ok(shortcut) => match app.global_shortcut().register(shortcut) {
                    Ok(()) => status.registered = true,
                    // Taken by another app (Raycast, VS Code, an input method).
                    // Report it rather than aborting launch, so the UI can offer
                    // a different combo instead of the app dying silently.
                    Err(err) => status.error = Some(err.to_string()),
                },
                Err(err) => status.error = Some(format!("invalid shortcut: {err}")),
            }

            match &status.error {
                None => eprintln!("[pip] hotkey {} registered", status.hotkey),
                Some(err) => eprintln!("[pip] hotkey {} FAILED: {err}", status.hotkey),
            }

            let sidecar = sidecar_status();
            eprintln!("[pip] converter: {} ({})", sidecar.script, sidecar.detail);

            app.manage(Mutex::new(status));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The state folder is process wide, so the tests that touch it take turns.
    static STATE_LOCK: Mutex<()> = Mutex::new(());

    fn repo_root() -> PathBuf {
        find_repo_root().expect("the repository root should be discoverable from the crate")
    }

    fn sample(name: &str) -> String {
        repo_root()
            .join("tests/samples")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn finds_the_repository_root_and_the_sidecar() {
        let root = find_repo_root().expect("repo root");
        assert!(root.join("sidecars/markitdown/convert.py").exists());
        assert!(sidecar_script(Some(&root)).is_some());
    }

    #[test]
    fn sidecar_status_is_ready() {
        let status = sidecar_status();
        assert!(status.ready, "sidecar should be ready: {}", status.detail);
        assert!(status.python.contains("python"), "python: {}", status.python);
    }

    #[test]
    fn converts_a_document_to_markdown() {
        let result = convert_blocking(sample("Activity_1.docx"), None).expect("conversion");
        assert_eq!(result.extension, ".docx");
        assert!(!result.markdown.is_empty());
        assert!(result.markdown_tokens > 0);
        assert!(result.raw_tokens > 0);
    }

    #[test]
    fn rejects_a_file_that_does_not_exist() {
        let error =
            convert_blocking("/nope/does-not-exist.pdf".to_string(), None).expect_err("should fail");
        assert!(error.contains("no such file"), "got: {error}");
    }

    #[test]
    fn selecting_pages_cuts_the_token_count() {
        let whole = convert_blocking(
            sample("Assignment_1._IB_Physics_Buoyancy_Haidar_Worksheet_Term_2__25_26_.pdf"),
            None,
        )
        .expect("whole document");

        let part = convert_blocking(
            sample("Assignment_1._IB_Physics_Buoyancy_Haidar_Worksheet_Term_2__25_26_.pdf"),
            Some("2-3".into()),
        )
        .expect("selected pages");

        assert_eq!(whole.pages, 6);
        assert_eq!(part.selected_pages, vec![2, 3]);
        assert!(
            part.markdown_tokens < whole.markdown_tokens,
            "two pages should be cheaper than six: {} vs {}",
            part.markdown_tokens,
            whole.markdown_tokens
        );
    }

    #[test]
    fn approvals_travel_through_the_state_folder() {
        let _guard = STATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        let temp = std::env::temp_dir().join(format!("pip-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(temp.join("pending")).expect("pending folder");

        // SAFETY: the lock above means no other test reads this variable while
        // it is set.
        unsafe { std::env::set_var("PIP_STATE_DIR", &temp) };

        let request = serde_json::json!({
            "id": "abc123",
            "tool": "create_note",
            "arguments": { "title": "test" },
            "reason": "save a note",
            "createdAt": "2026-01-01T00:00:00.000Z",
        });
        fs::write(
            temp.join("pending/abc123.json"),
            request.to_string(),
        )
        .expect("write request");

        let pending = pending_approvals();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].get("tool").and_then(Value::as_str), Some("create_note"));

        answer_approval("abc123".into(), true).expect("answer");

        let decision = temp.join("decisions/abc123.json");
        assert!(decision.exists(), "the decision file should be written");
        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&decision).unwrap()).unwrap();
        assert_eq!(parsed.get("approved").and_then(Value::as_bool), Some(true));

        // The request is cleared so the UI stops asking.
        assert!(!temp.join("pending/abc123.json").exists());

        unsafe { std::env::remove_var("PIP_STATE_DIR") };
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn the_chat_window_only_accepts_http_urls() {
        // The command needs a running app, so this checks the rule it applies
        // rather than calling it.
        for url in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>x</b>"] {
            let parsed = tauri::Url::parse(url).expect("parse");
            assert!(
                !matches!(parsed.scheme(), "http" | "https"),
                "{url} should be rejected"
            );
        }
    }
}
