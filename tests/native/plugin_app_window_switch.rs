//! Regression for the COM result → native window selection boundary, without touching Office.
use super::*;

#[path = "plugin_file_scope_fixture.rs"]
mod fixture;

#[link(name = "user32")]
extern "system" {
    fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
}

#[test]
fn reported_windows_reject_other_executables_and_dead_handles() {
    let _test = TEST_LOCK.lock().unwrap();
    let app = Window::new();
    unsafe {
        ShowWindow(app.0, 4);
    }
    let own_executable = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let resolve = crate::plugins::app_window::reported_window;
    assert_eq!(
        resolve(&own_executable, &app.0.to_string()).unwrap().hwnd,
        app.0.to_string()
    );
    assert!(resolve(r"C:\Windows\explorer.exe", &app.0.to_string()).is_none());
    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let child = Window(unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            class.as_ptr(),
            0x5000_0000,
            0,
            0,
            20,
            20,
            app.0,
            0,
            0,
            std::ptr::null_mut(),
        )
    });
    assert_ne!(child.0, 0);
    assert_eq!(
        resolve(&own_executable, &child.0.to_string()).unwrap().hwnd,
        app.0.to_string()
    );
    for invalid in ["0", "not-a-handle", "9999999999999999999999999"] {
        assert!(resolve(&own_executable, invalid).is_none());
    }
}

#[test]
#[ignore = "runs PowerShell with Shell.Application and creates only disposable test windows"]
fn com_active_document_replaces_a_larger_old_window_without_closing_either() {
    let _test = TEST_LOCK.lock().unwrap();
    let (old, replacement) = (Window::new(), Window::new());
    unsafe {
        SetWindowPos(old.0, 0, 20, 30, 800, 600, NO_ACTIVATE);
        ShowWindow(old.0, 4);
        ShowWindow(replacement.0, 4);
    }
    let executable = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let app = crate::plugins::app_discovery::App {
        id: "window-switch-regression".into(),
        name: "Window switch regression".into(),
        prog_id: "Shell.Application".into(),
        executable: executable.clone(),
        mcp: None,
    };
    let scratch = fixture::Scratch::new();
    let scope = crate::plugins::file_runtime::Scope {
        metadata: crate::plugins::file_runtime::TerminalFileScope {
            session_id: "issue-24-terminal".into(),
            project_id: "issue-24-project".into(),
            root_path: scratch.root().to_string_lossy().into_owned(),
        },
        root: std::sync::Arc::new(
            crate::plugins::file_scope::ProjectScope::new(&scratch.root()).unwrap(),
        ),
        epoch: "issue-24-epoch".into(),
    };
    // The old heuristic chooses A because it is larger, not the automated document B.
    assert_eq!(
        crate::plugins::app_window::main_window(&executable)
            .unwrap()
            .hwnd,
        old.0.to_string()
    );
    for hwnd in [replacement.0, old.0, replacement.0] {
        // Extend a harmless COM object with the same ActiveWindow.Hwnd contract Word exposes.
        let script = format!(
            "$app | Add-Member -MemberType NoteProperty -Name ActiveWindow -Value ([pscustomobject]@{{ Hwnd = {hwnd} }})\nWrite-Output 'document activated'"
        );
        let result = crate::plugins::app_script::run(
            &app,
            &script,
            &std::env::temp_dir(),
            std::time::Duration::from_secs(30),
            std::time::Instant::now(),
        )
        .unwrap();
        assert_eq!(result["exitCode"], 0, "{result}");
        assert_eq!(result["windowHwnd"], hwnd.to_string(), "{result}");
        let event = std::cell::RefCell::new(None);
        crate::plugins::apps::show_window(
            &app,
            &scope,
            &|value| {
                event.replace(Some(value));
            },
            result["windowHwnd"].as_str(),
        );
        let event = event.into_inner().unwrap();
        assert_eq!(event["appWindow"]["hwnd"], hwnd.to_string());
        assert_eq!(event["appWindow"]["terminal"], "issue-24-terminal");
        assert!(alive(old.0) && alive(replacement.0));
    }
}
