//! Win32 placement and ownership, restored only for the exact window we changed.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

pub type Hwnd = isize;
const GWL_STYLE: i32 = -16;
const GWLP_HWNDPARENT: i32 = -8;
const FRAME: isize = 0x00C0_0000 | 0x0004_0000 | 0x0008_0000 | 0x0002_0000 | 0x0001_0000;
/// SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS: moves are posted to the application's
/// thread. Style and owner changes still wait on it, so they run off the main thread and
/// outside the `DOCKED` lock.
const NO_ACTIVATE: u32 = 0x0004 | 0x0010 | 0x4000;

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Placement {
    length: u32,
    flags: u32,
    show: u32,
    min: Point,
    max: Point,
    rect: Rect,
}

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, data: isize) -> i32;
    fn IsWindow(hwnd: Hwnd) -> i32;
    fn GetAncestor(hwnd: Hwnd, flags: u32) -> Hwnd;
    fn IsWindowVisible(hwnd: Hwnd) -> i32;
    fn GetWindow(hwnd: Hwnd, command: u32) -> Hwnd;
    fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
    fn GetWindowPlacement(hwnd: Hwnd, placement: *mut Placement) -> i32;
    fn SetWindowPlacement(hwnd: Hwnd, placement: *const Placement) -> i32;
    fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
    fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
    fn ShowWindowAsync(hwnd: Hwnd, command: i32) -> i32;
    fn IsHungAppWindow(hwnd: Hwnd) -> i32;
    fn SendMessageTimeoutW(
        hwnd: Hwnd,
        msg: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
    fn SetForegroundWindow(hwnd: Hwnd) -> i32;
    fn SetPropW(hwnd: Hwnd, name: *const u16, value: isize) -> i32;
    fn GetPropW(hwnd: Hwnd, name: *const u16) -> isize;
    fn RemovePropW(hwnd: Hwnd, name: *const u16) -> isize;
}
#[link(name = "kernel32")]
extern "system" {
    fn SetLastError(error: u32);
    fn GetLastError() -> u32;
}

#[derive(Clone)]
struct Original {
    style: isize,
    owner: Hwnd,
    placement: Placement,
    visible: bool,
    lease: String,
    marker: isize,
}
#[derive(Default)]
struct DockState {
    windows: HashMap<Hwnd, Original>,
    closing: bool,
}
static DOCKED: Mutex<Option<DockState>> = Mutex::new(None);
fn marker_name() -> *const u16 {
    static NAME: OnceLock<Vec<u16>> = OnceLock::new();
    NAME.get_or_init(|| "Cairngorm.AppWindow.Dock\0".encode_utf16().collect())
        .as_ptr()
}
fn matches(hwnd: Hwnd, original: &Original) -> bool {
    alive(hwnd) && unsafe { GetPropW(hwnd, marker_name()) } == original.marker
}
pub fn is_docked(hwnd: Hwnd) -> bool {
    DOCKED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|state| state.windows.get(&hwnd))
        .is_some_and(|original| matches(hwnd, original))
}
/// A tracked lease losing its marker is closed, even if Windows recycled the handle.
pub fn session_closed(hwnd: Hwnd, lease: &str) -> bool {
    let mut guard = DOCKED.lock().unwrap_or_else(|e| e.into_inner());
    let Some(state) = guard.as_mut() else {
        return false;
    };
    let lost = state
        .windows
        .get(&hwnd)
        .is_some_and(|original| original.lease == lease && !matches(hwnd, original));
    if lost {
        state.windows.remove(&hwnd);
    }
    lost
}
pub fn alive(hwnd: Hwnd) -> bool {
    unsafe { IsWindow(hwnd) != 0 }
}
/// Automation APIs may expose a document child; docking needs its top-level frame.
pub fn root(hwnd: Hwnd) -> Hwnd {
    unsafe { GetAncestor(hwnd, 2) }
}

pub fn process(hwnd: Hwnd) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}
pub fn title(hwnd: Hwnd) -> String {
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), 512) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}
pub fn area(hwnd: Hwnd) -> i64 {
    let mut rect = Rect::default();
    unsafe { GetWindowRect(hwnd, &mut rect) };
    (rect.right - rect.left) as i64 * (rect.bottom - rect.top) as i64
}
/// Visible, unowned (or docked by us), titled top-level windows of `pids`.
pub fn windows_of(pids: &[u32]) -> Vec<Hwnd> {
    extern "system" fn each(hwnd: Hwnd, data: isize) -> i32 {
        unsafe { &mut *(data as *mut Vec<Hwnd>) }.push(hwnd);
        1
    }
    let mut all = Vec::new();
    unsafe { EnumWindows(each, &mut all as *mut Vec<Hwnd> as isize) };
    all.into_iter()
        .filter(|&hwnd| unsafe { IsWindowVisible(hwnd) } != 0)
        .filter(|&hwnd| is_docked(hwnd) || unsafe { GetWindow(hwnd, 4) } == 0)
        .filter(|&hwnd| pids.contains(&process(hwnd)) && !title(hwnd).is_empty())
        .collect()
}
fn set_long(hwnd: Hwnd, index: i32, value: isize) -> Result<(), String> {
    unsafe {
        SetLastError(0);
        if SetWindowLongPtrW(hwnd, index, value) == 0 && GetLastError() != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
/// Gives the window back its owner, frame and placement. Never called with `DOCKED` held:
/// these calls wait on the application's thread. A hung application only gets its owner back
/// (so closing Cairngorm cannot destroy it); its frame returns when it is released again.
fn restore(hwnd: Hwnd, original: &Original) -> Result<(), String> {
    if !matches(hwnd, original) {
        return Ok(());
    }
    set_long(hwnd, GWLP_HWNDPARENT, original.owner)?;
    if !responsive(hwnd) {
        return Err("The application is not responding; its window frame was not restored.".into());
    }
    set_long(hwnd, GWL_STYLE, original.style)?;
    let mut placement = original.placement;
    if !original.visible {
        placement.show = 0;
    }
    unsafe {
        if SetWindowPlacement(hwnd, &placement) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // Posted (asynchronous): ownership and style above are already restored.
        SetWindowPos(hwnd, 0, 0, 0, 0, 0, NO_ACTIVATE | 0x0001 | 0x0002 | 0x0020);
        RemovePropW(hwnd, marker_name());
    }
    Ok(())
}
/// Windows flags an application as hung only after 5 s without messages; a style change sent
/// to one that just went busy (Excel in a long call) would wait until it answers. Ask first,
/// briefly: closing runs on the UI thread.
fn responsive(hwnd: Hwnd) -> bool {
    let mut result = 0;
    unsafe {
        IsHungAppWindow(hwnd) == 0
            // WM_NULL with SMTO_ABORTIFHUNG, at most 250 ms.
            && SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0002, 250, &mut result) != 0
    }
}
fn closing_error() -> String {
    "Cairngorm is closing; application docking is paused.".into()
}
/// `DOCKED` only guards the bookkeeping: calls that wait on another process run without it,
/// so the main thread (which takes it while closing) never waits on a busy application.
#[allow(clippy::too_many_arguments)]
pub fn dock(
    hwnd: Hwnd,
    owner: Hwnd,
    lease: &str,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    visible: bool,
) -> Result<bool, String> {
    let fresh = {
        let mut guard = DOCKED.lock().unwrap_or_else(|e| e.into_inner());
        let state = guard.get_or_insert_with(DockState::default);
        if state.closing {
            return Err(closing_error());
        }
        let docked = &mut state.windows;
        if !alive(hwnd)
            || docked
                .get(&hwnd)
                .is_some_and(|original| !matches(hwnd, original))
        {
            docked.remove(&hwnd);
            return Ok(false);
        }
        if docked
            .get(&hwnd)
            .is_some_and(|original| original.lease != lease)
        {
            return Err("This application window is already shown in another pane.".into());
        }
        // A hung application is left alone until it responds again.
        if unsafe { IsHungAppWindow(hwnd) } != 0 {
            return Ok(true);
        }
        if docked.contains_key(&hwnd) {
            None
        } else {
            let mut placement = Placement {
                length: std::mem::size_of::<Placement>() as u32,
                ..Placement::default()
            };
            if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let original = Original {
                style: unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) },
                owner: unsafe { GetWindow(hwnd, 4) },
                placement,
                visible: unsafe { IsWindowVisible(hwnd) } != 0,
                lease: lease.into(),
                marker: (uuid::Uuid::new_v4().as_u128() as isize) | 1,
            };
            if unsafe { SetPropW(hwnd, marker_name(), original.marker) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            // Reserved: another pane now sees this window as taken.
            docked.insert(hwnd, original.clone());
            Some(original)
        }
    };
    let mut flags = NO_ACTIVATE;
    if let Some(original) = fresh {
        let changed = set_long(hwnd, GWLP_HWNDPARENT, owner)
            .and_then(|()| set_long(hwnd, GWL_STYLE, original.style & !FRAME));
        let closing = {
            let mut guard = DOCKED.lock().unwrap_or_else(|e| e.into_inner());
            let state = guard.get_or_insert_with(DockState::default);
            let gone = state.closing || !state.windows.contains_key(&hwnd);
            if changed.is_err() || gone {
                state.windows.remove(&hwnd);
            }
            gone
        };
        if changed.is_err() || closing {
            // Closing started meanwhile (or the change failed): undo before the owner goes.
            let _ = restore(hwnd, &original);
            return Err(changed.err().unwrap_or_else(closing_error));
        }
        if original.placement.show == 2 || original.placement.show == 3 {
            unsafe { ShowWindowAsync(hwnd, 9) };
        }
        flags |= 0x0020; // SWP_FRAMECHANGED
    }
    flags |= if visible { 0x0040 } else { 0x0080 };
    // Posted (asynchronous): never waits for the application.
    unsafe { SetWindowPos(hwnd, 0, x, y, w.max(1), h.max(1), flags) };
    Ok(true)
}
pub fn focus(hwnd: Hwnd) {
    unsafe { SetForegroundWindow(hwnd) };
}
pub fn release(hwnd: Hwnd, lease: Option<&str>) -> Result<(), String> {
    let original = {
        let mut guard = DOCKED.lock().unwrap_or_else(|e| e.into_inner());
        let Some(state) = guard.as_mut() else {
            return Ok(());
        };
        match state.windows.get(&hwnd) {
            Some(original) if lease.is_none_or(|lease| lease == original.lease) => {
                state.windows.remove(&hwnd)
            }
            _ => None,
        }
    };
    match original {
        Some(original) => restore(hwnd, &original),
        None => Ok(()),
    }
}
/// Called on the main thread while closing: the lock is held only to take the windows out.
pub fn prepare_close() -> Result<(), String> {
    let windows = {
        let mut guard = DOCKED.lock().unwrap_or_else(|e| e.into_inner());
        let state = guard.get_or_insert_with(DockState::default);
        state.closing = true;
        std::mem::take(&mut state.windows)
    };
    restore_all(windows)
}
pub fn cancel_close() {
    if let Some(state) = DOCKED.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        state.closing = false;
    }
}
fn restore_all(windows: HashMap<Hwnd, Original>) -> Result<(), String> {
    let errors: Vec<String> = windows
        .iter()
        .filter_map(|(&hwnd, original)| {
            restore(hwnd, original)
                .err()
                .map(|error| format!("Could not release application window {hwnd}: {error}"))
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}
pub fn release_all() {
    // Panic hooks can run while this thread holds DOCKED; never deadlock the crash handler.
    let take = |state: &mut DockState| {
        state.closing = true;
        std::mem::take(&mut state.windows)
    };
    let windows = match DOCKED.try_lock() {
        Ok(mut guard) => guard.as_mut().map(take),
        Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner().as_mut().map(take),
        Err(std::sync::TryLockError::WouldBlock) => {
            eprintln!("[app-window] Could not release application windows: docking is busy.");
            return;
        }
    };
    if let Err(error) = restore_all(windows.unwrap_or_default()) {
        eprintln!("[app-window] {error}");
    }
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_window.rs"]
mod tests;
