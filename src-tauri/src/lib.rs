#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Setup (log plugin nur im Debug)
  builder = builder.setup(|app| {
    if cfg!(debug_assertions) {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
    }
    Ok(())
  });

  // Core plugins (plattformunabhängig)
  builder = builder
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    // Used by FiveEToolsLink (and any future external-link UI) to open
    // a URL in the user's default browser. Without this plugin, anchor
    // tags inside the Tauri webview do nothing for http(s) targets.
    .plugin(tauri_plugin_opener::init())
    // CORS-free HTTP for fetching remote images (e.g. 5e.tools token art that
    // the webview can't use as a WebGL texture due to missing CORS headers).
    .plugin(tauri_plugin_http::init());

  // Desktop-only plugin (Android-safe)
  #[cfg(not(target_os = "android"))]
  {
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
  }

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}