//! Provider bundles as one unit: every file is read once, hashed together and copied from
//! those same bytes, so what the user approved is exactly what gets installed and served.
use super::manifest;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

const MAX_FILES: usize = 512;
const MAX_BUNDLE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_DEPTH: usize = 8;

pub struct Bundle {
    /// Relative paths with forward slashes, sorted, with their content.
    pub files: Vec<(String, Vec<u8>)>,
    /// SHA-256 over every path and content digest: the approval token.
    pub hash: String,
}

impl Bundle {
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|(_, data)| data.len() as u64).sum()
    }

    pub fn file(&self, relative: &str) -> Option<&[u8]> {
        self.files
            .iter()
            .find(|(path, _)| path == relative)
            .map(|(_, data)| data.as_slice())
    }

    /// Writes exactly the hashed bytes into a fresh folder.
    pub fn write_to(&self, target: &Path) -> Result<(), String> {
        for (relative, data) in &self.files {
            let to = target.join(relative);
            fs::create_dir_all(to.parent().unwrap_or(target)).map_err(|e| e.to_string())?;
            fs::write(&to, data).map_err(|e| format!("{relative}: {e}"))?;
        }
        Ok(())
    }
}

/// Links are refused and dot-entries skipped, so a bundle cannot reach outside its folder.
pub fn read(source: &Path) -> Result<Bundle, String> {
    let root = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if !root.is_dir() || is_link(&root) {
        return Err("Choose the provider's folder.".into());
    }
    let mut files = Vec::new();
    let mut total = 0u64;
    let mut pending = vec![(source.to_path_buf(), String::new(), 0)];
    while let Some((dir, prefix, depth)) = pending.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if !manifest::valid_segment(&name) {
                return Err(format!("Unsupported file name \"{name}\" in the provider."));
            }
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            if is_link(&metadata) {
                return Err(format!(
                    "\"{relative}\" is a link; providers must contain real files."
                ));
            }
            if metadata.is_dir() {
                if depth + 1 >= MAX_DEPTH {
                    return Err("The provider folder is nested too deeply.".into());
                }
                pending.push((entry.path(), relative, depth + 1));
            } else if metadata.is_file() {
                let data = read_file(&entry.path(), MAX_BUNDLE_BYTES - total)?;
                total += data.len() as u64;
                files.push((relative, data));
                if files.len() > MAX_FILES {
                    return Err(too_large());
                }
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let hash = hash(&files);
    Ok(Bundle { files, hash })
}

/// Reads through the opened handle and re-checks it, so a swap after the walk is refused.
fn read_file(path: &Path, remaining: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err("The provider changed while it was being read.".into());
    }
    let mut data = Vec::new();
    file.take(remaining + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > remaining {
        return Err(too_large());
    }
    Ok(data)
}

fn too_large() -> String {
    "The provider is too large (512 files and 32 MiB maximum).".into()
}

pub fn hash(files: &[(String, Vec<u8>)]) -> String {
    let mut all = Sha256::new();
    for (relative, data) in files {
        all.update(relative.as_bytes());
        all.update([0]);
        all.update(format!("{:x}", Sha256::digest(data)).as_bytes());
        all.update(b"\n");
    }
    format!("{:x}", all.finalize())
}

pub fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & REPARSE_POINT != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
