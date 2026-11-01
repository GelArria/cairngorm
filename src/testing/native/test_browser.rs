use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::TcpListener,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;
#[path = "./test_frame_cache.rs"]
mod frames;
#[path = "./test_browser_http.rs"]
mod http;
#[path = "./test_browser_relay.rs"]
mod relay;
pub use frames::response as frame_response;

#[tauri::command]
pub async fn test_browser_freeze(image_id: String) -> Result<String, String> {
    crate::blocking(move || {
        frames::snapshot(&image_id).ok_or("Browser frame is no longer available".into())
    })
    .await?
}

static ENDPOINT: OnceLock<Result<String, String>> = OnceLock::new();
static SESSIONS: OnceLock<Mutex<HashMap<String, (String, Arc<relay::Relay>)>>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEvent {
    #[serde(rename = "type")]
    kind: String,
    page_id: String,
    timestamp: u64,
    #[serde(default)]
    image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_id: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    test_name: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    browser_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    project_name: Option<String>,
    #[serde(default)]
    activity_id: Option<String>,
    #[serde(default)]
    started_at: Option<u64>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

fn valid(event: &BrowserEvent) -> bool {
    if event.page_id.is_empty() || event.page_id.len() > 128 || event.image_id.is_some() {
        return false;
    }
    if event.kind == "activity" {
        return event
            .activity_id
            .as_ref()
            .is_some_and(|s| !s.is_empty() && s.len() <= 128)
            && event.started_at.is_some_and(|t| t <= event.timestamp)
            && event
                .label
                .as_ref()
                .is_some_and(|s| !s.is_empty() && s.len() <= 512)
            && event
                .status
                .as_deref()
                .is_some_and(|s| ["running", "completed", "failed", "interrupted"].contains(&s))
            && event.image.is_none()
            && event.test_name.as_ref().is_none_or(|s| s.len() <= 8192);
    }
    if event.kind == "closed" {
        return event.image.is_none();
    }
    event.kind == "frame"
        && event.image.as_ref().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 1_800_000
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
        })
        && valid_frame_metadata(event)
}

fn valid_frame_metadata(event: &BrowserEvent) -> bool {
    !event.page_id.is_empty()
        && event.page_id.len() <= 128
        && event.width.is_some_and(|n| n > 0 && n <= 16384)
        && event.height.is_some_and(|n| n > 0 && n <= 16384)
        && event
            .browser_name
            .as_deref()
            .is_none_or(|s| ["chromium", "firefox", "webkit"].contains(&s))
        && event.project_name.as_ref().is_none_or(|s| s.len() <= 512)
        && [&event.url, &event.title, &event.test_name]
            .iter()
            .all(|s| s.as_ref().is_none_or(|s| s.len() <= 8192))
}

fn start(app: &tauri::AppHandle) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let app = app.clone();
    std::thread::spawn(move || {
        // A fixed worker pool bounds connections and their buffers, including stalled clients.
        for _ in 0..4 {
            let listener = listener.try_clone().expect("clone test browser listener");
            let app = app.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else {
                        continue;
                    };
                    let accepted = http::read_request(&mut stream)
                        .ok()
                        .and_then(|(token, body)| {
                            let (id, relay) = SESSIONS.get()?.lock().ok()?.get(&token)?.clone();
                            let (mut event, jpeg) = decode_event(&body)?;
                            if jpeg.is_empty() {
                                if !valid(&event) {
                                    return None;
                                }
                                if let Some(image) = event.image.take() {
                                    let bytes = base64::Engine::decode(
                                        &base64::engine::general_purpose::STANDARD,
                                        image,
                                    )
                                    .ok()?;
                                    event.image_id =
                                        Some(frames::store(&id, &event.page_id, bytes)?);
                                }
                            } else {
                                if event.kind != "frame"
                                    || event.image.is_some()
                                    || event.image_id.is_some()
                                {
                                    return None;
                                }
                                if !valid_frame_metadata(&event) {
                                    return None;
                                }
                                event.image_id = Some(frames::store(&id, &event.page_id, jpeg)?);
                            }
                            relay.publish(&app, &id, event);
                            Some(())
                        })
                        .is_some();
                    http::respond(&mut stream, accepted);
                }
            });
        }
    });
    Ok(format!("http://{address}/frame"))
}

fn decode_event(body: &[u8]) -> Option<(BrowserEvent, Vec<u8>)> {
    if body.first() == Some(&b'{') {
        return Some((serde_json::from_slice(body).ok()?, Vec::new()));
    }
    let length = u32::from_be_bytes(body.get(..4)?.try_into().ok()?) as usize;
    if length == 0 || length > 32768 {
        return None;
    }
    let end = 4 + length;
    Some((
        serde_json::from_slice(body.get(4..end)?).ok()?,
        body.get(end..)?.to_vec(),
    ))
}

pub fn release(id: &str) {
    if let Some(sessions) = SESSIONS.get() {
        sessions.lock().unwrap().retain(|_, (owner, _)| owner != id);
    }
}

/// Installs a versioned, bundled preload and preserves the terminal's existing Node flags.
pub fn configure(app: &tauri::AppHandle, id: &str, cmd: &mut CommandBuilder) -> Result<(), String> {
    let endpoint = ENDPOINT
        .get_or_init(|| start(app))
        .as_ref()
        .map_err(Clone::clone)?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("integrations/testing-v1");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    for (name, content) in [
        (
            "playwright-preload.cjs",
            include_str!("../assets/playwright-preload.cjs"),
        ),
        (
            "playwright-stream.cjs",
            include_str!("../assets/playwright-stream.cjs"),
        ),
        (
            "playwright-activity.cjs",
            include_str!("../assets/playwright-activity.cjs"),
        ),
    ] {
        let path = directory.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(content) {
            std::fs::write(path, content).map_err(|e| e.to_string())?;
        }
    }
    let preload = directory
        .join("playwright-preload.cjs")
        .to_string_lossy()
        .replace('\\', "/");
    if preload.contains(['"', '\n', '\r']) {
        return Err("unsupported preload path".into());
    }
    let options = cmd
        .get_env("NODE_OPTIONS")
        .map(|v| v.to_string_lossy().to_string())
        .or_else(|| std::env::var("NODE_OPTIONS").ok())
        .unwrap_or_default();
    let token = uuid::Uuid::new_v4().to_string();
    release(id);
    SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .insert(
            token.clone(),
            (id.into(), Arc::new(relay::Relay::default())),
        );
    cmd.env("NODE_OPTIONS", format!("{options} --require \"{preload}\""));
    cmd.env("CAIRNGORM_TEST_ENDPOINT", endpoint);
    cmd.env("CAIRNGORM_TEST_TOKEN", token);
    cmd.env("CAIRNGORM_TEST_BINARY", "1");
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/native/test-browser.rs"]
mod tests;
