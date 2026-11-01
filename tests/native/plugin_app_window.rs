use super::*;
static TEST_LOCK: Mutex<()> = Mutex::new(());

#[path = "plugin_app_window_switch.rs"]
mod document_switch;

#[link(name = "user32")]
extern "system" {
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Hwnd,
        menu: isize,
        instance: isize,
        data: *mut std::ffi::c_void,
    ) -> Hwnd;
    fn DestroyWindow(hwnd: Hwnd) -> i32;
}

struct Window(Hwnd);
impl Window {
    fn new() -> Self {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0x00CF0000,
                20,
                30,
                200,
                100,
                0,
                0,
                0,
                std::ptr::null_mut(),
            )
        };
        assert_ne!(hwnd, 0);
        Self(hwnd)
    }
}
impl Drop for Window {
    fn drop(&mut self) {
        let _ = release(self.0, None);
        unsafe { DestroyWindow(self.0) };
    }
}

#[test]
fn native_window_docking_preserves_placement_and_has_one_lease() {
    let _test = TEST_LOCK.lock().unwrap();
    let (owner, app) = (Window::new(), Window::new());
    let hwnd = app.0;
    let original_style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    let mut original = Placement {
        length: std::mem::size_of::<Placement>() as u32,
        ..Placement::default()
    };
    assert_ne!(unsafe { GetWindowPlacement(hwnd, &mut original) }, 0);
    assert_eq!(
        dock(hwnd, owner.0, "pane-1", 100, 120, 400, 300, false),
        Ok(true)
    );
    assert!(is_docked(hwnd));
    assert_eq!(unsafe { GetWindow(hwnd, 4) }, owner.0);
    assert_eq!(unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & FRAME, 0);
    assert!(dock(hwnd, owner.0, "pane-2", 0, 0, 100, 100, false).is_err());
    release(hwnd, Some("pane-2")).unwrap();
    assert!(is_docked(hwnd));
    release(hwnd, Some("pane-1")).unwrap();
    assert!(!is_docked(hwnd));
    assert_eq!(unsafe { GetWindow(hwnd, 4) }, 0);
    assert_eq!(
        unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) },
        original_style
    );
    assert_eq!(unsafe { IsWindowVisible(hwnd) }, 0);
    let mut restored = original;
    unsafe { GetWindowPlacement(hwnd, &mut restored) };
    assert_eq!(restored.rect.left, original.rect.left);
    assert_eq!(restored.rect.top, original.rect.top);
    assert_eq!(restored.rect.right, original.rect.right);
    assert_eq!(restored.rect.bottom, original.rect.bottom);
}

#[test]
fn hidden_project_windows_keep_their_lease_and_reappear_without_closing() {
    let _test = TEST_LOCK.lock().unwrap();
    let (owner, app) = (Window::new(), Window::new());
    let hwnd = app.0;
    assert_eq!(
        dock(hwnd, owner.0, "project-pane", 100, 120, 400, 300, true),
        Ok(true)
    );
    assert_ne!(unsafe { IsWindowVisible(hwnd) }, 0);
    assert_eq!(
        dock(hwnd, owner.0, "project-pane", 0, 0, 1, 1, false),
        Ok(true)
    );
    assert_eq!(unsafe { IsWindowVisible(hwnd) }, 0);
    assert!(alive(hwnd) && is_docked(hwnd));
    assert_eq!(unsafe { GetWindow(hwnd, 4) }, owner.0);
    assert_eq!(
        dock(hwnd, owner.0, "project-pane", 100, 120, 400, 300, true),
        Ok(true)
    );
    assert_ne!(unsafe { IsWindowVisible(hwnd) }, 0);
    assert!(alive(hwnd) && is_docked(hwnd));
}

#[test]
fn closed_or_recycled_windows_are_not_restored_or_redocked() {
    let _test = TEST_LOCK.lock().unwrap();
    let (owner, app) = (Window::new(), Window::new());
    let hwnd = app.0;
    dock(hwnd, owner.0, "pane-old", 100, 120, 400, 300, false).unwrap();
    // Window properties disappear when a handle is recycled, even within the same process.
    unsafe { RemovePropW(hwnd, marker_name()) };
    assert!(!is_docked(hwnd));
    // Recognize the lost lease before authorizing the replacement process.
    assert_eq!(
        crate::plugins::app_window_commands::checked(&hwnd.to_string(), "pane-old"),
        Ok(None)
    );
    assert!(!DOCKED
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .windows
        .contains_key(&hwnd));
    unsafe { SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0) };
    unsafe { DestroyWindow(hwnd) };
    assert_eq!(
        dock(hwnd, owner.0, "pane-old", 0, 0, 10, 10, false),
        Ok(false)
    );
    release(hwnd, Some("pane-old")).unwrap();
}

#[test]
fn closing_releases_windows_and_refuses_late_docks_until_cancelled() {
    let _test = TEST_LOCK.lock().unwrap();
    let (owner, app) = (Window::new(), Window::new());
    dock(app.0, owner.0, "pane-1", 0, 0, 100, 100, false).unwrap();
    prepare_close().unwrap();
    assert!(!is_docked(app.0));
    assert_eq!(unsafe { GetWindow(app.0, 4) }, 0);
    let late = dock(app.0, owner.0, "pane-1", 0, 0, 100, 100, false);
    cancel_close();
    assert!(late.unwrap_err().contains("closing"));
    assert_eq!(unsafe { GetWindow(app.0, 4) }, 0);
    assert_eq!(
        dock(app.0, owner.0, "pane-1", 0, 0, 100, 100, false),
        Ok(true)
    );
}

#[repr(C)]
struct Msg {
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt: [i32; 2],
    private: u32,
}
#[link(name = "user32")]
extern "system" {
    fn PeekMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
    fn TranslateMessage(msg: *const Msg) -> i32;
    fn DispatchMessageW(msg: *const Msg) -> isize;
}

/// An application window on its own thread that pumps messages until `hang` is sent, then
/// stops answering for `stall` (like Excel busy in a long COM call), then closes.
fn application_that_hangs(
    stall: std::time::Duration,
) -> (
    Hwnd,
    std::sync::mpsc::Sender<()>,
    std::thread::JoinHandle<()>,
) {
    let (window_tx, window_rx) = std::sync::mpsc::channel();
    let (hang_tx, hang_rx) = std::sync::mpsc::channel::<()>();
    let thread = std::thread::spawn(move || {
        let app = Window::new();
        window_tx.send(app.0).unwrap();
        loop {
            let mut msg: Msg = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut msg, 0, 0, 0, 1) } != 0 {
                unsafe {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            if hang_rx.try_recv().is_ok() {
                std::thread::sleep(stall);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        unsafe { SetWindowLongPtrW(app.0, GWLP_HWNDPARENT, 0) };
        unsafe { RemovePropW(app.0, marker_name()) };
        drop(app);
    });
    (window_rx.recv().unwrap(), hang_tx, thread)
}

#[link(name = "user32")]
extern "system" {
    fn SendMessageTimeoutW(
        hwnd: Hwnd,
        msg: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
}

type Task = Box<dyn FnOnce() + Send>;

/// Cairngorm's UI thread: owns the main window, pumps messages and runs the tasks the UI
/// thread runs (closing). Returns the window, a task sender and the thread.
fn ui_thread() -> (
    Hwnd,
    std::sync::mpsc::Sender<Task>,
    std::thread::JoinHandle<()>,
) {
    let (window_tx, window_rx) = std::sync::mpsc::channel();
    let (task_tx, task_rx) = std::sync::mpsc::channel::<Task>();
    let thread = std::thread::spawn(move || {
        let owner = Window::new();
        window_tx.send(owner.0).unwrap();
        loop {
            let mut msg: Msg = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut msg, 0, 0, 0, 1) } != 0 {
                unsafe {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            match task_rx.try_recv() {
                Ok(task) => task(),
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    std::thread::sleep(std::time::Duration::from_millis(5))
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
    });
    (window_rx.recv().unwrap(), task_tx, thread)
}

/// The UI thread answers a message within `limit` (it is not blocked by the application).
fn answers(hwnd: Hwnd, limit: std::time::Duration) -> bool {
    let mut result = 0;
    // SMTO_ABORTIFHUNG
    unsafe {
        SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0002, limit.as_millis() as u32, &mut result) != 0
    }
}

/// The break (owner report 10-22: crash on close-then-resize with Excel docked): the docked
/// application stops answering and Cairngorm's UI thread, which owns the docked window,
/// waits on it while resizing or closing. Docking runs on a worker thread as in
/// `app_window_dock`; closing runs on the UI thread as in `app_window_prepare_close`.
#[test]
fn resizing_or_closing_never_waits_on_a_hung_docked_window() {
    use std::time::{Duration, Instant};
    let _test = TEST_LOCK.lock().unwrap();
    let (owner, ui, ui_thread) = ui_thread();
    let on_ui = |task: Task| -> Duration {
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let started = Instant::now();
        ui.send(Box::new(move || {
            task();
            done_tx.send(()).unwrap();
        }))
        .unwrap();
        done_rx.recv().unwrap();
        started.elapsed()
    };
    let limit = Duration::from_millis(1500);
    let mut findings = Vec::new();
    for close_after in [Duration::from_millis(300), Duration::from_secs(6)] {
        let (hwnd, hang, app) = application_that_hangs(Duration::from_secs(9));
        let pane = format!("pane-{}", close_after.as_millis());
        assert_eq!(dock(hwnd, owner, &pane, 0, 0, 300, 200, true), Ok(true));
        hang.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let started = Instant::now();
        assert_eq!(dock(hwnd, owner, &pane, 10, 10, 640, 480, true), Ok(true));
        if started.elapsed() > limit {
            findings.push(format!("resize (worker) waited {:?}", started.elapsed()));
        }
        if !answers(owner, limit) {
            findings.push("UI thread stopped answering while the docked window hung".into());
        }
        std::thread::sleep(close_after.saturating_sub(Duration::from_millis(300)));
        let took = on_ui(Box::new(|| {
            let _ = prepare_close();
        }));
        if took > limit {
            findings.push(format!(
                "closing {close_after:?} after the hang waited {took:?} on the UI thread"
            ));
        }
        on_ui(Box::new(cancel_close));
        app.join().unwrap();
    }
    drop(ui);
    ui_thread.join().unwrap();
    assert!(findings.is_empty(), "{findings:#?}");
}
