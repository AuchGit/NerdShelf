// Embedded VTT relay — a WebSocket fan-out hub + HTTP map/handout file server,
// hosted by the GM's own app so a direct/P2P session needs no separate Node
// process. Mirrors scripts/vtt-relay.mjs: every WS message is rebroadcast to
// the OTHER peers; `__persist`/`__snapshot` cache the latest snapshot and it is
// replayed to each new peer; /map/<name> serves & accepts full-res originals.
use std::net::{SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path, State,
    },
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{broadcast, oneshot};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct Hub {
    tx: broadcast::Sender<(u64, String)>,
    snapshot: Arc<Mutex<Option<String>>>,
    maps_dir: Arc<PathBuf>,
    ids: Arc<AtomicU64>,
}

#[derive(Default)]
pub struct RelayState {
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    running: Mutex<Option<String>>, // the ws:// url while running
}

// Best-effort LAN IPv4 (so players can connect): open a throwaway UDP socket
// "to" a public address and read which local interface the OS picked. No packet
// is actually sent.
fn local_ip() -> String {
    (|| {
        let s = UdpSocket::bind("0.0.0.0:0").ok()?;
        s.connect("8.8.8.8:80").ok()?;
        Some(s.local_addr().ok()?.ip().to_string())
    })()
    .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn sanitize(n: &str) -> String {
    n.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn mime_for(n: &str) -> &'static str {
    match n.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "webp" => "image/webp",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

// GET "/" → plain text; WS upgrade → join the fan-out hub.
async fn root(ws: Option<WebSocketUpgrade>, State(hub): State<Hub>) -> Response {
    match ws {
        Some(up) => up.on_upgrade(move |sock| client(sock, hub)),
        None => "VTT relay OK".into_response(),
    }
}

async fn client(sock: WebSocket, hub: Hub) {
    let id = hub.ids.fetch_add(1, Ordering::Relaxed);
    let (mut ws_tx, mut ws_rx) = sock.split();
    let mut rx = hub.tx.subscribe();

    // Replay the cached snapshot to the new peer (late-join handshake).
    let snap = hub.snapshot.lock().unwrap().clone();
    if let Some(s) = snap {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            let out = serde_json::json!({ "senderId": "relay", "op": { "type": "__snapshot", "snapshot": v } });
            let _ = ws_tx.send(Message::Text(out.to_string())).await;
        }
    }

    // Forward broadcasts from OTHER peers to this socket.
    let send_task = tokio::spawn(async move {
        while let Ok((from, text)) = rx.recv().await {
            if from == id {
                continue;
            }
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            let mut is_persist = false;
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                let t = v
                    .get("op")
                    .and_then(|o| o.get("type"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if t == "__persist" || t == "__snapshot" {
                    if let Some(s) = v.get("op").and_then(|o| o.get("snapshot")) {
                        if !s.is_null() {
                            *hub.snapshot.lock().unwrap() = Some(s.to_string());
                        }
                    }
                    if t == "__persist" {
                        is_persist = true; // cached only, never rebroadcast
                    }
                }
            }
            if !is_persist {
                let _ = hub.tx.send((id, text));
            }
        }
    }
    send_task.abort();
}

async fn get_map(Path(name): Path<String>, State(hub): State<Hub>) -> Response {
    let safe = sanitize(&name);
    let path = hub.maps_dir.join(&safe);
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, mime_for(&safe)),
                (header::CACHE_CONTROL, "public, max-age=31536000"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn put_map(Path(name): Path<String>, State(hub): State<Hub>, body: Bytes) -> Response {
    let safe = sanitize(&name);
    let _ = tokio::fs::create_dir_all(hub.maps_dir.as_path()).await;
    let path = hub.maps_dir.join(&safe);
    match tokio::fs::write(&path, &body).await {
        Ok(_) => (StatusCode::OK, "ok").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Start (or restart) the embedded relay. Returns the shareable ws:// URL.
#[tauri::command]
pub async fn start_relay(
    state: tauri::State<'_, RelayState>,
    port: u16,
    maps_dir: String,
) -> Result<String, String> {
    // Stop any previous instance first.
    if let Some(tx) = state.shutdown.lock().unwrap().take() {
        let _ = tx.send(());
    }
    let maps = PathBuf::from(&maps_dir);
    let _ = std::fs::create_dir_all(&maps);

    let (btx, _) = broadcast::channel::<(u64, String)>(2048);
    let hub = Hub {
        tx: btx,
        snapshot: Arc::new(Mutex::new(None)),
        maps_dir: Arc::new(maps),
        ids: Arc::new(AtomicU64::new(1)),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/map/:name", get(get_map).put(put_map))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(hub);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Port {} belegt? {}", port, e))?;

    let (sd_tx, sd_rx) = oneshot::channel::<()>();
    *state.shutdown.lock().unwrap() = Some(sd_tx);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = sd_rx.await;
            })
            .await;
    });

    let url = format!("ws://{}:{}", local_ip(), port);
    *state.running.lock().unwrap() = Some(url.clone());
    Ok(url)
}

/// All non-loopback IPv4 addresses of this machine WITH their interface name
/// (Ethernet, WLAN, "Radmin VPN", …) so the DM sees which network each IP
/// belongs to when choosing what to share the session over. The relay already
/// binds 0.0.0.0, so every returned IP reaches it.
#[derive(serde::Serialize)]
pub struct IpInfo {
    pub ip: String,
    pub name: String,
}

#[tauri::command]
pub fn list_local_ips() -> Vec<IpInfo> {
    let mut out: Vec<IpInfo> = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for ifa in ifaces {
            let ip = ifa.ip();
            if ip.is_ipv4() && !ip.is_loopback() {
                out.push(IpInfo { ip: ip.to_string(), name: ifa.name.clone() });
            }
        }
    }
    out.sort_by(|a, b| a.ip.cmp(&b.ip));
    out.dedup_by(|a, b| a.ip == b.ip);
    out
}

/// Stop the embedded relay (graceful).
#[tauri::command]
pub fn stop_relay(state: tauri::State<'_, RelayState>) -> Result<(), String> {
    if let Some(tx) = state.shutdown.lock().unwrap().take() {
        let _ = tx.send(());
    }
    *state.running.lock().unwrap() = None;
    Ok(())
}
