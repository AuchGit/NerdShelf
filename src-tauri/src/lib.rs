mod relay;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Single instance (desktop): opening a nerdshelf:// link while the app runs
  // hands the link to this window (deep-link feature) and brings it to the
  // front instead of launching a second copy. Must be the first plugin.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      use tauri::Manager;
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
      }
    }));
  }

  builder = builder
    // nerdshelf:// links; the frontend turns them into routes.
    .plugin(tauri_plugin_deep_link::init())
    // Embedded VTT relay: hosted by the GM's app, auto-started on session start.
    .manage(relay::RelayState::default())
    .invoke_handler(tauri::generate_handler![relay::start_relay, relay::stop_relay, relay::list_local_ips]);

  // Setup (log plugin nur im Debug)
  builder = builder.setup(|app| {
    // Make sure the scheme points at this installation (the installer
    // registers it too; this also covers dev builds and moved installs).
    #[cfg(any(windows, target_os = "linux"))]
    {
      use tauri_plugin_deep_link::DeepLinkExt;
      let _ = app.deep_link().register_all();
    }
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