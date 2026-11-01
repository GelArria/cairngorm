//! Win32 observation of an application's windows: a modal dialog (a dialog-class window, or
//! any window whose owner is disabled while it shows) and windows that stopped responding.
//! Read-only: nothing is clicked, closed or focused.
use super::Observation;

type Hwnd = isize;
const GW_OWNER: u32 = 4;
const MAX_TEXT: usize = 400;

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, data: isize) -> i32;
    fn EnumChildWindows(
        parent: Hwnd,
        callback: extern "system" fn(Hwnd, isize) -> i32,
        data: isize,
    ) -> i32;
    fn IsWindowVisible(hwnd: Hwnd) -> i32;
    fn IsWindowEnabled(hwnd: Hwnd) -> i32;
    fn IsHungAppWindow(hwnd: Hwnd) -> i32;
    fn GetWindow(hwnd: Hwnd, command: u32) -> Hwnd;
    fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    fn GetClassNameW(hwnd: Hwnd, name: *mut u16, max: i32) -> i32;
    fn InternalGetWindowText(hwnd: Hwnd, text: *mut u16, max: i32) -> i32;
}

extern "system" fn collect(hwnd: Hwnd, data: isize) -> i32 {
    unsafe { &mut *(data as *mut Vec<Hwnd>) }.push(hwnd);
    1
}

fn top_level() -> Vec<Hwnd> {
    let mut all = Vec::new();
    unsafe { EnumWindows(collect, &mut all as *mut Vec<Hwnd> as isize) };
    all
}

fn children(hwnd: Hwnd) -> Vec<Hwnd> {
    let mut all = Vec::new();
    unsafe { EnumChildWindows(hwnd, collect, &mut all as *mut Vec<Hwnd> as isize) };
    all
}

fn process(hwnd: Hwnd) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

fn class(hwnd: Hwnd) -> String {
    let mut buffer = [0u16; 128];
    let length = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), 128) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

/// Never sends a message to the window, so a hung application cannot block us.
fn text(hwnd: Hwnd) -> String {
    let mut buffer = [0u16; 512];
    let length = unsafe { InternalGetWindowText(hwnd, buffer.as_mut_ptr(), 512) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
        .trim()
        .to_string()
}

fn enabled(hwnd: Hwnd) -> bool {
    unsafe { IsWindowEnabled(hwnd) != 0 }
}

/// A window the application waits on: one whose owner (a window of the application itself,
/// never Cairngorm's window a docked application is owned by) it disabled, or an unowned
/// dialog box while the application has no other window to work in. Modeless dialogs such as
/// a reminders list leave their owner enabled and are not counted.
fn modal(hwnd: Hwnd, windows: &[Hwnd], pids: &[u32]) -> bool {
    if !enabled(hwnd) {
        return false;
    }
    let owner = unsafe { GetWindow(hwnd, GW_OWNER) };
    if owner != 0 {
        return pids.contains(&process(owner)) && !enabled(owner);
    }
    class(hwnd) == "#32770"
        && !windows.iter().any(|&other| {
            other != hwnd && unsafe { GetWindow(other, GW_OWNER) } == 0 && enabled(other)
        })
}

/// Progress windows offer only a way to stop; they do not wait for an answer.
fn only_cancels(buttons: &[String]) -> bool {
    const STOP: &[&str] = &[
        "cancel",
        "cancelar",
        "annuler",
        "abbrechen",
        "annulla",
        "stop",
    ];
    matches!(buttons, [only] if STOP.contains(&only.to_lowercase().as_str()))
}

/// "Title: message [Button] [Button]", from what the dialog's controls show; `None` for a
/// progress window.
fn describe(hwnd: Hwnd) -> Option<String> {
    let mut parts = vec![text(hwnd)];
    let mut buttons = Vec::new();
    for child in children(hwnd) {
        if unsafe { IsWindowVisible(child) } == 0 {
            continue;
        }
        let label = text(child).replace('&', "");
        if label.is_empty() {
            continue;
        }
        match class(child).as_str() {
            "Button" => buttons.push(label),
            "Static" => parts.push(label),
            _ => {}
        }
    }
    if only_cancels(&buttons) {
        return None;
    }
    parts.retain(|part| !part.is_empty());
    let mut description = parts.join(": ");
    for button in &buttons {
        description.push_str(&format!(" [{button}]"));
    }
    let description = description.split_whitespace().collect::<Vec<_>>().join(" ");
    let description = match description.char_indices().nth(MAX_TEXT) {
        Some((end, _)) => format!("{}…", &description[..end]),
        None => description,
    };
    Some(if description.is_empty() {
        "(untitled dialog)".into()
    } else {
        description
    })
}

pub fn observe(pids: &[u32]) -> Observation {
    if pids.is_empty() {
        return Observation {
            observed: true,
            ..Observation::default()
        };
    }
    let windows: Vec<Hwnd> = top_level()
        .into_iter()
        .filter(|&hwnd| unsafe { IsWindowVisible(hwnd) } != 0 && pids.contains(&process(hwnd)))
        .collect();
    let dialog = windows
        .iter()
        .filter(|&&hwnd| modal(hwnd, &windows, pids))
        .find_map(|&hwnd| describe(hwnd));
    let hung = windows
        .iter()
        .any(|&hwnd| unsafe { IsHungAppWindow(hwnd) } != 0);
    Observation {
        dialog,
        hung,
        observed: true,
    }
}
