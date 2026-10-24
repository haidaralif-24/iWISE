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
    markdown_chars: usize,
    raw_chars: usize,
    markdown_tokens: usize,
    raw_tokens: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    ready: bool,
    /// "bundled" for a shipped helper, "script" for a development checkout.
    kind: String,
    /// The executable that gets spawned.
    program: String,
    /// The helper binary, or convert.py in a checkout.
    target: String,
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

/// Where the converter comes from.
///
/// A shipped app carries a self-contained helper inside `Contents/Resources`
/// and has neither a Python interpreter nor a repository, so the old
/// "walk up from the working directory until convert.py appears" lookup could
/// never succeed there: launched from Finder, the working directory is `/`.
///
/// A development checkout still runs `convert.py` with the sidecar venv.
#[derive(Clone, Debug)]
enum Converter {
    /// Self-contained executable (PyInstaller): run it directly.
    Helper { binary: PathBuf },
    /// Development checkout: run the script with a Python interpreter.
    Script { python: String, script: PathBuf },
}

impl Converter {
    fn program(&self) -> String {
        match self {
            Converter::Helper { binary } => binary.to_string_lossy().into_owned(),
            Converter::Script { python, .. } => python.clone(),
        }
    }

    /// Arguments that come before the document path.
    fn leading_args(&self) -> Vec<String> {
        match self {
            Converter::Helper { .. } => Vec::new(),
            Converter::Script { script, .. } => vec![script.to_string_lossy().into_owned()],
        }
    }

    fn target(&self) -> String {
        match self {
            Converter::Helper { binary } => binary.to_string_lossy().into_owned(),
            Converter::Script { script, .. } => script.to_string_lossy().into_owned(),
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Converter::Helper { .. } => "bundled",
            Converter::Script { .. } => "script",
        }
    }

    fn exists(&self) -> bool {
        Path::new(&self.target()).exists()
    }
}

/// The helper binary inside a Resources directory, if present.
fn helper_in(dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "markitdown-helper.exe"
    } else {
        "markitdown-helper"
    };

    // Tauri v2 copies `resources` entries to Contents/Resources on macOS, but a
    // glob entry keeps its folder, so check a nested copy as well.
    for candidate in [dir.join(name), dir.join("resources").join(name)] {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

/// Resolution order: explicit override, bundled helper, development checkout.
///
/// Split from `resolve_converter` so the order can be tested without a running
/// app: the bundled path is the one that only exists in a shipped build.
fn resolve_converter_from(resources: Option<&Path>) -> Option<Converter> {
    if let Ok(configured) = std::env::var("PIP_CONVERT_SCRIPT") {
        let script = PathBuf::from(configured.trim());
        if script.exists() {
            let root = find_repo_root();
            return Some(Converter::Script {
                python: python_executable(root.as_deref()),
                script,
            });
        }
    }

    if let Some(dir) = resources {
        if let Some(binary) = helper_in(dir) {
            return Some(Converter::Helper { binary });
        }
    }

    let root = find_repo_root()?;
    let script = root.join("sidecars/markitdown/convert.py");
    if !script.exists() {
        return None;
    }

    Some(Converter::Script {
        python: python_executable(Some(&root)),
        script,
    })
}

fn resolve_converter(app: Option<&AppHandle>) -> Option<Converter> {
    let resources = app.and_then(|handle| handle.path().resource_dir().ok());
    resolve_converter_from(resources.as_deref())
}

#[tauri::command]
fn sidecar_status(app: AppHandle) -> SidecarStatus {
    let converter = resolve_converter(Some(&app));

    let Some(converter) = converter else {
        return SidecarStatus {
            ready: false,
            kind: "missing".into(),
            program: "not found".into(),
            target: "not found".into(),
            detail: "The converter is missing from this build. Reinstall Pip, or set PIP_CONVERT_SCRIPT."
                .into(),
        };
    };

    let ready = converter.exists();
    let detail = if !ready {
        format!("The converter is missing at {}", converter.target())
    } else if let Converter::Script { python, .. } = &converter {
        if python.contains('/') && !Path::new(python).exists() {
            "the Python environment is missing. Run: uv venv sidecars/markitdown/.venv && uv pip install -r sidecars/markitdown/requirements.txt".into()
        } else {
            "ready".into()
        }
    } else {
        "ready".into()
    };

    SidecarStatus {
        ready,
        kind: converter.kind().into(),
        program: converter.program(),
        target: converter.target(),
        detail,
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
fn convert_blocking(
    converter: &Converter,
    path: String,
    pages: Option<String>,
) -> Result<ConvertResult, String> {
    if !converter.exists() {
        return Err(format!("the converter is missing at {}", converter.target()));
    }

    let program = converter.program();
    let mut args: Vec<String> = converter.leading_args();
    args.push(path);
    args.push("--json".into());
    if let Some(pages) = pages.filter(|value| !value.trim().is_empty()) {
        args.push("--pages".into());
        args.push(pages);
    }

    let mut child = Command::new(&program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("could not run {program}: {err}"))?;

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
        markdown_chars: number(&stats, "markdownChars") as usize,
        raw_chars: number(&stats, "rawChars") as usize,
        markdown_tokens: number(&stats, "markdownTokens") as usize,
        raw_tokens: number(&stats, "rawTokens") as usize,
    })
}

#[tauri::command]
async fn convert_document(
    app: AppHandle,
    path: String,
    pages: Option<String>,
) -> Result<ConvertResult, String> {
    // Resolved on the command thread, where the app handle is available, so a
    // shipped build finds the bundled helper instead of looking for a repo.
    let converter = resolve_converter(Some(&app))
        .ok_or("the converter is missing from this build. Reinstall Pip, or set PIP_CONVERT_SCRIPT.")?;

    // The conversion blocks for as long as the document takes, so it runs on a
    // worker thread rather than the UI thread.
    tauri::async_runtime::spawn_blocking(move || convert_blocking(&converter, path, pages))
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

// ---------------------------------------------------------------------------
// Folder access.
//
// The user grants folders one at a time from this window. The MCP server reads
// the same file on every tool call, so a grant takes effect immediately and
// nothing has to be restarted. Nothing outside these folders is readable, and
// nothing at all is shared until the user adds it.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SharedFolder {
    path: String,
    /// The notes folder is always shared: `create_note` writes there.
    always: bool,
    /// False when the folder was granted but has since been deleted or unmounted.
    present: bool,
}

fn allowlist_file() -> PathBuf {
    state_dir().join("allowlist.json")
}

fn read_shared_folders_from(file: &Path) -> Vec<String> {
    let raw = match fs::read_to_string(file) {
        Ok(raw) => raw,
        // No file yet means the user has granted nothing. Not an error.
        Err(_) => return Vec::new(),
    };

    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parsed
        .get("folders")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_str)
                .map(|entry| entry.trim().to_string())
                .filter(|entry| !entry.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn write_shared_folders_to(file: &Path, folders: &[String]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }

    let temp = file.with_extension("json.tmp");
    let payload = serde_json::json!({ "folders": folders });

    // Write then rename. A crash mid-write must not leave a truncated file that
    // the server would read as "the user shares nothing".
    fs::write(&temp, serde_json::to_vec_pretty(&payload).map_err(|err| err.to_string())?)
        .map_err(|err| format!("could not write {}: {err}", temp.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    }

    fs::rename(&temp, file).map_err(|err| format!("could not save {}: {err}", file.display()))
}

fn read_shared_folders() -> Vec<String> {
    read_shared_folders_from(&allowlist_file())
}

fn write_shared_folders(folders: &[String]) -> Result<(), String> {
    write_shared_folders_to(&allowlist_file(), folders)
}

/// Canonicalise, so a granted symlink is stored as its target and matches what
/// the server compares against.
fn canonical_folder(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("no folder given".into());
    }

    let expanded = if let Some(rest) = raw.strip_prefix('~') {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        PathBuf::from(home).join(rest.trim_start_matches('/'))
    } else {
        PathBuf::from(raw)
    };

    let resolved = fs::canonicalize(&expanded)
        .map_err(|_| format!("no such folder: {}", expanded.display()))?;

    if !resolved.is_dir() {
        return Err(format!("not a folder: {}", resolved.display()));
    }

    Ok(resolved)
}

#[tauri::command]
fn shared_folders() -> Vec<SharedFolder> {
    let mut folders: Vec<SharedFolder> = read_shared_folders()
        .into_iter()
        .map(|path| {
            let present = Path::new(&path).is_dir();
            SharedFolder { path, always: false, present }
        })
        .collect();

    // Shown first and never removable: `create_note` writes here.
    folders.insert(
        0,
        SharedFolder {
            path: notes_dir().to_string_lossy().into_owned(),
            always: true,
            present: true,
        },
    );

    folders
}

/// Component-wise containment: `/a/b` is within `/a`, `/a/bc` is not.
fn is_within(parent: &Path, child: &Path) -> bool {
    child.starts_with(parent)
}

#[tauri::command]
fn add_shared_folder(path: String) -> Result<Vec<SharedFolder>, String> {
    let target = canonical_folder(&path)?;
    let mut folders = read_shared_folders();

    for existing in &folders {
        // Already covered by a broader grant, or granted exactly.
        if let Ok(existing_path) = fs::canonicalize(existing) {
            if is_within(&existing_path, &target) {
                return Ok(shared_folders());
            }
        }
    }

    // Drop narrower grants that the new one now covers, so one folder does not
    // appear twice in the list.
    folders.retain(|existing| match fs::canonicalize(existing) {
        Ok(existing_path) => !is_within(&target, &existing_path),
        Err(_) => true,
    });

    folders.push(target.to_string_lossy().into_owned());
    write_shared_folders(&folders)?;
    Ok(shared_folders())
}

#[tauri::command]
fn remove_shared_folder(path: String) -> Result<Vec<SharedFolder>, String> {
    let notes = fs::canonicalize(notes_dir()).ok();
    let target = fs::canonicalize(&path).ok();

    if let (Some(notes), Some(target)) = (&notes, &target) {
        if notes == target {
            return Err("the notes folder is always shared".into());
        }
    }

    let folders: Vec<String> = read_shared_folders()
        .into_iter()
        .filter(|existing| match (fs::canonicalize(existing).ok(), &target) {
            (Some(existing_path), Some(target)) => existing_path != *target,
            _ => existing != &path,
        })
        .collect();

    write_shared_folders(&folders)?;
    Ok(shared_folders())
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
            sidecar_status,
            convert_document,
            pending_approvals,
            answer_approval,
            audit_log,
            list_notes,
            shared_folders,
            add_shared_folder,
            remove_shared_folder
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

            let sidecar = sidecar_status(app.handle().clone());
            eprintln!(
                "[pip] converter ({}): {} — {}",
                sidecar.kind, sidecar.target, sidecar.detail
            );

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

    /// In a checkout there is no app handle, so resolution falls through to the
    /// repository lookup — which is the path a developer actually uses.
    fn converter() -> Converter {
        resolve_converter(None).expect("a converter should be resolvable from the repository")
    }

    #[test]
    fn finds_the_repository_root_and_the_sidecar() {
        let root = find_repo_root().expect("repo root");
        assert!(root.join("sidecars/markitdown/convert.py").exists());

        let resolved = converter();
        assert_eq!(resolved.kind(), "script", "a checkout resolves to the script");
        assert!(resolved.exists());
    }

    #[test]
    fn the_converter_is_ready() {
        let resolved = converter();
        assert!(resolved.exists(), "converter at {}", resolved.target());
        assert!(resolved.program().contains("python"), "program: {}", resolved.program());
    }

    #[test]
    fn converts_a_document_to_markdown() {
        let result = convert_blocking(&converter(), sample("Activity_1.docx"), None)
            .expect("conversion");
        assert_eq!(result.extension, ".docx");
        assert!(!result.markdown.is_empty());
        assert!(result.markdown_tokens > 0);
        assert!(result.raw_tokens > 0);
    }

    #[test]
    fn rejects_a_file_that_does_not_exist() {
        let error = convert_blocking(&converter(), "/nope/does-not-exist.pdf".to_string(), None)
            .expect_err("should fail");
        assert!(error.contains("no such file"), "got: {error}");
    }

    #[test]
    fn selecting_pages_cuts_the_token_count() {
        let whole = convert_blocking(
            &converter(),
            sample("Assignment_1._IB_Physics_Buoyancy_Haidar_Worksheet_Term_2__25_26_.pdf"),
            None,
        )
        .expect("whole document");

        let part = convert_blocking(
            &converter(),
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

    // -- folder access ------------------------------------------------------

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pip-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn the_allowlist_file_round_trips() {
        let dir = scratch("allowlist");
        let file = dir.join("allowlist.json");

        assert!(read_shared_folders_from(&file).is_empty(), "no file yet");

        let folders = vec![dir.to_string_lossy().into_owned()];
        write_shared_folders_to(&file, &folders).expect("write");
        assert_eq!(read_shared_folders_from(&file), folders);

        // The list says which of the user's folders may be read, so it is
        // owner-only like the token.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&file).expect("metadata").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "allowlist should not be world readable");
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_allowlist_reads_as_empty() {
        let dir = scratch("broken");
        let file = dir.join("allowlist.json");
        fs::write(&file, "{ this is not json").expect("write");

        assert!(
            read_shared_folders_from(&file).is_empty(),
            "a corrupt file must fail closed, not guess"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn granting_a_file_instead_of_a_folder_is_refused() {
        let dir = scratch("file-grant");
        let file = dir.join("notes.txt");
        fs::write(&file, "x").expect("write");

        let error = canonical_folder(&file.to_string_lossy()).expect_err("a file is not a folder");
        assert!(error.contains("not a folder"), "got: {error}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn granting_a_folder_that_does_not_exist_is_refused() {
        let error = canonical_folder("/nope/not/here").expect_err("missing folder");
        assert!(error.contains("no such folder"), "got: {error}");
    }

    #[test]
    fn containment_is_component_wise() {
        let parent = Path::new("/a/b");
        assert!(is_within(parent, Path::new("/a/b")), "a folder contains itself");
        assert!(is_within(parent, Path::new("/a/b/c.pdf")));
        assert!(!is_within(parent, Path::new("/a/bc/d.pdf")), "prefix is not containment");
        assert!(!is_within(parent, Path::new("/a")));
    }

    #[test]
    fn a_bundled_helper_wins_over_the_repository() {
        let dir = scratch("bundle");
        let helper = dir.join(if cfg!(windows) {
            "markitdown-helper.exe"
        } else {
            "markitdown-helper"
        });
        fs::write(&helper, b"#!/bin/sh\n").expect("write helper");

        let resolved = resolve_converter_from(Some(&dir)).expect("a bundled converter");
        assert_eq!(resolved.kind(), "bundled", "a shipped build must use the helper");
        assert_eq!(resolved.target(), helper.to_string_lossy());
        assert!(resolved.leading_args().is_empty(), "the helper takes no script argument");
        assert_eq!(resolved.program(), helper.to_string_lossy());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_resources_folder_falls_through_to_the_repository() {
        let dir = scratch("no-bundle");
        let resolved = resolve_converter_from(Some(&dir)).expect("repository fallback");
        assert_eq!(resolved.kind(), "script");
        assert!(resolved.leading_args().len() == 1, "the script is passed as an argument");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_notes_folder_is_always_listed_first() {
        let folders = shared_folders();
        assert!(!folders.is_empty(), "notes should always be present");
        assert!(folders[0].always, "notes should be first and marked always");
    }
}
