//! Keep document links from navigating away from the application shell.
#[cfg(any(windows, test))]
use tauri::Url;
use tauri::{plugin::TauriPlugin, Runtime};
#[cfg(windows)]
use tauri::{Manager, Webview};
#[cfg(windows)]
use tauri_plugin_shell::ShellExt;

#[cfg(any(windows, test))]
fn handle_navigation(
    label: &str,
    url: &Url,
    app_url: &Url,
    open_external: impl FnOnce(&Url),
) -> bool {
    if label != "main" && !label.starts_with("detached-") {
        return true;
    }
    let no_credentials = url.username().is_empty() && url.password().is_none();
    // Url::origin is opaque for tauri:// URLs, so compare the components explicitly.
    if no_credentials
        && url.scheme() == app_url.scheme()
        && url.host_str() == app_url.host_str()
        && url.port_or_known_default() == app_url.port_or_known_default()
    {
        return true;
    }
    if no_credentials
        && url.as_str().len() <= 8192
        && matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
    {
        open_external(url);
    }
    false
}

#[cfg(windows)]
fn application_url<R: Runtime>(view: &Webview<R>) -> Url {
    #[cfg(dev)]
    if let Some(url) = view.app_handle().config().build.dev_url.as_ref() {
        return url.clone();
    }
    let config = &view.app_handle().config().app.windows;
    let https = config
        .iter()
        .find(|window| window.label == view.label())
        .or_else(|| config.iter().find(|window| window.label == "main"))
        .is_some_and(|window| window.use_https_scheme);
    let origin = if https {
        "https://tauri.localhost"
    } else {
        "http://tauri.localhost"
    };
    Url::parse(origin).expect("valid application origin")
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("navigation-guard");
    // shortcut: WebKit also reports iframe loads here; require a frame-aware hook before enabling there.
    #[cfg(windows)]
    let builder = builder.on_navigation(|view, url| {
        handle_navigation(view.label(), url, &application_url(view), |url| {
            let app = view.app_handle().clone();
            let url = url.to_string();
            // Never wait for an OS browser process on the webview's navigation callback.
            tauri::async_runtime::spawn_blocking(move || {
                #[allow(deprecated)]
                if let Err(error) = app.shell().open(url, None) {
                    eprintln!("[navigation] Could not open the external browser: {error}");
                }
            });
        })
    });
    builder.build()
}

#[cfg(test)]
#[path = "../../../tests/native/navigation.rs"]
mod tests;
