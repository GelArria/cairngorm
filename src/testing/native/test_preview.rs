//! WRY (MIT) uses the system webview; no additional browser engine is bundled.
use serde::Deserialize;
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewBuilder, WebviewUrl};

pub fn app_invoke<R: tauri::Runtime>(
    invoke: tauri::ipc::Invoke<R>,
    commands: &impl Fn(tauri::ipc::Invoke<R>) -> bool,
) -> bool {
    // Tauri app commands have no ACL by default. External preview content must
    // never reach filesystem, process, credential or other application commands.
    if invoke
        .message
        .webview()
        .label()
        .starts_with("test-preview-")
    {
        invoke
            .resolver
            .reject("Application commands are unavailable in browser previews");
        true
    } else {
        commands(invoke)
    }
}

#[derive(Clone, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Bounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width > 0.0
            && self.height > 0.0
            && self.width <= 16384.0
            && self.height <= 16384.0
    }
    fn rect(&self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: LogicalSize::new(self.width, self.height).into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Open,
    Navigate,
    Back,
    Forward,
    Reload,
    Layout,
    Close,
}

fn allowed(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}
fn parse_url(url: Option<String>) -> Result<tauri::Url, String> {
    let url = url
        .filter(|s| s.len() <= 8192)
        .ok_or("Enter an HTTP or HTTPS address")?;
    let url = tauri::Url::parse(&url).map_err(|_| "Invalid browser address")?;
    if !allowed(&url) {
        return Err("Only HTTP and HTTPS addresses without credentials are supported".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn test_preview(
    webview: Webview,
    preview_id: String,
    action: Action,
    url: Option<String>,
    bounds: Option<Bounds>,
    visible: Option<bool>,
) -> Result<(), String> {
    // Preview pages cannot control another webview or the app's browser controls.
    if webview.label() != "main" && !webview.label().starts_with("detached-") {
        return Err("Browser controls require an application webview".into());
    }
    let id = uuid::Uuid::parse_str(&preview_id).map_err(|_| "Invalid browser identifier")?;
    let label = format!("test-preview-{}-{id}", webview.label());
    crate::blocking(move || {
        let app = webview.app_handle();
        if let Action::Close = action {
            return app
                .get_webview(&label)
                .map(|v| v.close().map_err(|e| e.to_string()))
                .unwrap_or(Ok(()));
        }
        if let Action::Open = action {
            let url = parse_url(url)?;
            let bounds = bounds
                .filter(Bounds::valid)
                .ok_or("Invalid browser bounds")?;
            if let Some(view) = app.get_webview(&label) {
                return view.navigate(url).map_err(|e| e.to_string());
            }
            let event = format!("test-preview-{id}");
            let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
                .incognito(true).disable_drag_drop_handler()
                .on_navigation(allowed)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_page_load(move |view, payload| {
                    crate::emit_safe::emit_bg(&view, &event, serde_json::json!({
                        "url": payload.url().as_str(),
                        "loading": matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                    }));
                });
            #[cfg(windows)]
            // WebView2 cannot share the parent's environment with different
            // browser arguments: the controller can be created but never load.
            let builder = if let Some(args) = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == webview.window().label())
                .or_else(|| {
                    app.config()
                        .app
                        .windows
                        .iter()
                        .find(|window| window.label == "main")
                })
                .and_then(|window| window.additional_browser_args.as_deref())
            {
                builder.additional_browser_args(args)
            } else {
                builder
            };
            let view = webview
                .window()
                .add_child(
                    builder,
                    LogicalPosition::new(bounds.x, bounds.y),
                    LogicalSize::new(bounds.width, bounds.height),
                )
                .map_err(|e| e.to_string())?;
            if visible == Some(false) {
                view.hide().map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        let view = app.get_webview(&label).ok_or("Browser is closed")?;
        match action {
            Action::Navigate => view.navigate(parse_url(url)?),
            Action::Back => view.eval("history.back()"),
            Action::Forward => view.eval("history.forward()"),
            Action::Reload => view.reload(),
            Action::Layout => {
                if visible == Some(false) {
                    view.hide()
                } else {
                    let bounds = bounds
                        .filter(Bounds::valid)
                        .ok_or("Invalid browser bounds")?;
                    view.set_bounds(bounds.rect()).and_then(|_| view.show())
                }
            }
            _ => unreachable!(),
        }
        .map_err(|e| e.to_string())
    })
    .await?
}

#[cfg(test)]
#[path = "../../../tests/native/test-preview.rs"]
mod tests;
