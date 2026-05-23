#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, AppHandle, Emitter};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use std::sync::Mutex;

struct BadgeState(Mutex<u32>);

// ─── Commands ───────────────────────────────────────────────

#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) {
    let _ = app.emit("notification", serde_json::json!({
        "title": title,
        "body": body
    }));
}

#[tauri::command]
fn update_tray_badge(_app: AppHandle, state: tauri::State<BadgeState>, count: u32) {
    let mut cur = state.0.lock().unwrap();
    *cur = count;
}

#[tauri::command]
fn clear_tray_badge(state: tauri::State<BadgeState>) {
    let mut cur = state.0.lock().unwrap();
    *cur = 0;
}

#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

// Autostart wrappers — exposed under the same names the frontend already uses
// in `useTauriNotifications.js` (`set_autostart` / `get_autostart`).
//
// The official `tauri-plugin-autostart` plugin records the actual bundled exe
// path in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, so the broken
// "empty cmd window + Edge unreachable page" symptom — caused by a stale Run
// entry pointing at the dev command / dev URL — is replaced with a clean
// launch of the production binary.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let mgr = app.autolaunch();
    if enabled { mgr.enable().map_err(|e| e.to_string())?; }
    else       { mgr.disable().map_err(|e| e.to_string())?; }
    mgr.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

// ─── One-time cleanup of broken Run-key entries ────────────────────────────
//
// Previous (broken) attempts at autostart may have left stale entries in the
// Windows Run key. The two we've seen in the wild:
//   • a `SupaManager` value pointing at `cmd /c npm run dev` (opens an empty
//     cmd window on boot), and
//   • a value pointing at `http://localhost:1420` which gets opened in the
//     default browser → "Diese Seite ist nicht erreichbar" in Edge.
//
// We delete any entry under those names whose value does NOT match the
// current exe path. The autostart plugin will then re-create a correct one
// the next time the user toggles the setting.
#[cfg(windows)]
fn cleanup_stale_autostart(app: &AppHandle) {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let current_exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_lowercase(),
        Err(_) => return,
    };

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run = match hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
    ) {
        Ok(k) => k,
        Err(_) => return,
    };

    // Names previous broken builds may have used.
    for name in ["SupaManager", "supa-manager", "de.dndbehind.supamanager"] {
        let Ok(value) = run.get_value::<String, _>(name) else { continue };
        let lower = value.to_lowercase();
        // Anything obviously wrong:
        //   - starts cmd / powershell
        //   - mentions npm / vite / localhost / http
        //   - points at a path that no longer exists on disk
        let looks_broken =
            lower.contains("cmd")           ||
            lower.contains("powershell")    ||
            lower.contains("npm")           ||
            lower.contains("vite")          ||
            lower.contains("localhost")     ||
            lower.contains("http://")       ||
            lower.contains("https://")      ||
            !lower.contains(&current_exe);

        if looks_broken {
            let _ = run.delete_value(name);
            let _ = app.emit("autostart-cleanup", name);
            eprintln!("[autostart] removed stale Run entry '{name}' = {value}");
        }
    }
}

#[cfg(not(windows))]
fn cleanup_stale_autostart(_app: &AppHandle) {}

// ─── Main ───────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(BadgeState(Mutex::new(0)))
        // tauri-plugin-autostart owns the Run-key entry and uses the real
        // bundled exe path (no cmd / no dev URL). We pass `--start-minimized`
        // so the boot-time launch starts hidden — the user sees the tray
        // icon, not a window popping in their face.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--start-minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            show_notification,
            update_tray_badge,
            clear_tray_badge,
            show_window,
            hide_to_tray,
            set_autostart,
            get_autostart,
        ])
        .setup(|app| {
            // First — sweep any old broken Run entries so the next user toggle
            // doesn't fight with a leftover that points at the dev command.
            cleanup_stale_autostart(&app.handle());

            // If we were started by autostart, hide the window. The tray icon
            // remains; the user can open the window from there.
            let args: Vec<String> = std::env::args().collect();
            if args.iter().any(|a| a == "--start-minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
