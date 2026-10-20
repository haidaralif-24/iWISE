use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Day-1 default. `CmdOrCtrl` maps to Cmd on macOS and Ctrl on Windows/Linux,
/// so one string covers all three platforms.
const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+Space";

/// Default chat window size. Height matches the Pip window so the two sit side
/// by side as one unit. The window is resizable; these are only the opening size.
const CHAT_WIDTH: f64 = 820.0;
const CHAT_HEIGHT: f64 = 680.0;

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
fn open_chat(app: tauri::AppHandle, url: String) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        .invoke_handler(tauri::generate_handler![hotkey_status, open_chat])
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

            app.manage(Mutex::new(status));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
