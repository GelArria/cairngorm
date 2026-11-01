//! Downloading and verifying an installer, then running it once Cairngorm has closed
//! through its normal path (unsaved changes and terminal checks included).
use minisign_verify::{PublicKey, Signature};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

/// Installers are tens of MB; anything larger is refused before it fills the disk.
const MAX_INSTALLER: u64 = 512 * 1024 * 1024;

static INSTALLING: AtomicBool = AtomicBool::new(false);
/// A verified installer waiting for the app to exit, with its signature file.
static PENDING: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);

/// One install at a time: the guard is released when dropped.
pub struct InstallGuard;

impl InstallGuard {
    pub fn acquire() -> Result<Self, String> {
        if INSTALLING.swap(true, Ordering::SeqCst) {
            return Err("An update is already being prepared".into());
        }
        Ok(Self)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

fn decode_text(base64_text: &str) -> Result<String, String> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        base64_text.trim(),
    )
    .map_err(|_| "invalid base64")?;
    String::from_utf8(bytes).map_err(|_| "invalid text".into())
}

/// Tauri's updater format: the public key and the `.sig` file both hold base64 of a
/// minisign file. Only installers signed by the release key are accepted.
pub fn verify_signature(
    bytes: &[u8],
    signature_file: &str,
    public_key: &str,
) -> Result<(), String> {
    if public_key.trim().is_empty() {
        return Err("No update signing key is configured".into());
    }
    let key = PublicKey::decode(&decode_text(public_key)?).map_err(|_| "Invalid signing key")?;
    let signature =
        Signature::decode(&decode_text(signature_file)?).map_err(|_| "Invalid update signature")?;
    key.verify(bytes, &signature, false).map_err(|_| {
        "The installer is not signed by Cairngorm's release key; nothing was installed".into()
    })
}

/// Reads the whole download into memory (bounded) for the signature check.
pub fn read_bounded(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_INSTALLER + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Download failed: {e}"))?;
    if bytes.len() as u64 > MAX_INSTALLER {
        return Err("The installer is larger than allowed".into());
    }
    Ok(bytes)
}

/// Writes verified bytes to a fresh file nobody else can be rewriting.
pub fn stage(bytes: &[u8], extension: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("cairngorm-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // A fixed, sanitised name: never a file name taken from the release.
    let path = dir.join(format!(
        "cairngorm-setup-{}{extension}",
        uuid::Uuid::new_v4().simple()
    ));
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .and_then(|mut file| file.write_all(bytes));
    if let Err(error) = written {
        let _ = fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path)
}

/// Keeps one staged installer: a newer download replaces (and deletes) the previous one.
pub fn set_pending(path: PathBuf, signature: String) {
    let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((old, _)) = pending.replace((path, signature)) {
        let _ = fs::remove_file(old);
    }
}

pub fn has_pending() -> bool {
    PENDING.lock().map(|p| p.is_some()).unwrap_or(false)
}

/// Called as the app exits: re-verify the staged installer (it may have waited for
/// hours in a user-writable folder), then start it. A per-user installer needs no
/// elevation; a per-machine one would (error 740). The app is closing, so a failure
/// can only be logged; the next check offers the update again.
pub fn launch_pending(public_key: &str) {
    let Some((path, signature)) = PENDING.lock().ok().and_then(|mut p| p.take()) else {
        return;
    };
    let verified = fs::File::open(&path)
        .map_err(|e| e.to_string())
        .and_then(read_bounded)
        .and_then(|bytes| verify_signature(&bytes, &signature, public_key));
    let started = verified.and_then(|()| {
        std::process::Command::new(&path)
            .spawn()
            .map(drop)
            .map_err(|e| e.to_string())
    });
    if let Err(error) = started {
        eprintln!("[updates] the update was not installed: {error}");
        let _ = fs::remove_file(path);
    }
}
