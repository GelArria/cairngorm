//! Taskbar icon at the exact size Windows draws it. Tauri's default window icon is
//! the ICO's first entry (16 px) and the Win11 taskbar upscales it to 24 px, so it
//! looks blurry. Instead pick the entry for 24 px × the window's scale factor
//! (icon.ico carries 24…60 for 100–250 %; scripts/gen-brand-icons.mjs).
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{image::Image, Window};

const ICO: &[u8] = include_bytes!("../../../src-tauri/icons/icon.ico");
const TASKBAR_PX: f64 = 24.0;

/// PNG bytes of the smallest entry ≥ `px` (or the largest one when none is).
fn ico_entry(px: u32) -> Option<&'static [u8]> {
    let count = u16::from_le_bytes([*ICO.get(4)?, *ICO.get(5)?]) as usize;
    let mut best: Option<(u32, &'static [u8])> = None;
    for i in 0..count {
        let e = ICO.get(6 + i * 16..6 + (i + 1) * 16)?;
        let size = if e[0] == 0 { 256 } else { e[0] as u32 };
        let len = u32::from_le_bytes(e[8..12].try_into().ok()?) as usize;
        let off = u32::from_le_bytes(e[12..16].try_into().ok()?) as usize;
        let data = ICO.get(off..off + len)?;
        let better = match best {
            None => true,
            Some((b, _)) if b < px => size > b,
            Some((b, _)) => size >= px && size < b,
        };
        if better {
            best = Some((size, data));
        }
    }
    best.map(|(_, d)| d)
}

/// Re-applied on focus and on DPI change, so detached windows and monitor moves are covered.
pub fn apply(window: &Window) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let px = (TASKBAR_PX * scale).round() as u32;
    let label = window.label().to_string();
    if applied().get(&label) == Some(&px) {
        return;
    }
    let Some(png) = ico_entry(px) else { return };
    match Image::from_bytes(png)
        .map_err(|e| e.to_string())
        .and_then(|img| window.set_icon(img).map_err(|e| e.to_string()))
    {
        // remembered only once it worked, so a failure is retried on the next focus
        Ok(()) => {
            applied().insert(label, px);
        }
        Err(e) => eprintln!("[window-icon] {px}px entry: {e}"),
    }
}

/// A destroyed window's label can come back (detach → reattach → detach again
/// reuses `detached-<tabId>`): drop it so the new window gets its icon.
pub fn forget(window: &Window) {
    applied().remove(window.label());
}

/// Size last applied per window label — focus fires often, the icon rarely changes.
fn applied() -> MutexGuard<'static, HashMap<String, u32>> {
    static APPLIED: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    APPLIED
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::ico_entry;

    /// Width of the PNG behind an entry (IHDR width, bytes 16..20).
    fn width(png: &[u8]) -> u32 {
        u32::from_be_bytes(png[16..20].try_into().unwrap())
    }

    #[test]
    fn picks_the_exact_taskbar_size_or_the_next_larger() {
        assert_eq!(ico_entry(24).map(width), Some(24)); // 100 %
        assert_eq!(ico_entry(30).map(width), Some(30)); // 125 %
        assert_eq!(ico_entry(36).map(width), Some(36)); // 150 %
        assert_eq!(ico_entry(42).map(width), Some(48)); // 175 %
        assert_eq!(ico_entry(60).map(width), Some(60)); // 250 %
        assert_eq!(ico_entry(9999).map(width), Some(256)); // nothing larger → largest
    }
}
