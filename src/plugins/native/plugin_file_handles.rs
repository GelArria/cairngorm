//! Pin each ancestor before opening its child; never follow a reparse point.
use std::{
    fs::File,
    path::{Path, PathBuf},
};

pub(super) struct PinnedFile {
    pub file: File,
    _parents: Vec<File>,
    disk_path: PathBuf,
}

#[cfg(windows)]
use std::{ffi::c_void, os::windows::io::AsRawHandle};
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetFinalPathNameByHandleW(handle: *mut c_void, path: *mut u16, size: u32, flags: u32)
        -> u32;
    fn GetVolumeNameForVolumeMountPointW(path: *const u16, volume: *mut u16, size: u32) -> i32;
}

#[cfg(windows)]
fn open_component(path: &Path, directory: bool) -> Result<File, String> {
    use std::{
        fs::OpenOptions,
        os::windows::fs::{MetadataExt, OpenOptionsExt},
    };
    let file = OpenOptions::new()
        .read(true)
        .share_mode(1) // Deny writes (including reparse changes) and deletion/rename.
        .custom_flags(0x0020_0000 | if directory { 0x0200_0000 } else { 0 })
        .open(path)
        .map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    // shortcut: local links/mount points also fail closed; add verified link resolution when needed.
    if metadata.file_attributes() & 0x400 != 0 {
        return Err("Reparse-point paths are not supported for agent file access.".into());
    }
    if if directory {
        !metadata.is_dir()
    } else {
        !metadata.is_file()
    } {
        return Err("The requested path has the wrong file type.".into());
    }
    Ok(file)
}

#[cfg(windows)]
pub(super) fn open(path: &Path, directory: bool) -> Result<PinnedFile, String> {
    use std::{
        ffi::OsString,
        os::windows::ffi::OsStringExt,
        path::{Component, Prefix},
    };
    let mut parts = path.components();
    let drive = match parts.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return Err("Only local disk paths are supported.".into()),
        },
        _ => return Err("An absolute local disk path is required.".into()),
    };
    if parts.next() != Some(Component::RootDir) {
        return Err("An absolute local disk path is required.".into());
    }
    // Resolve the drive through the local mount manager, not a file open on a mapped drive.
    // A GUID volume path cannot be retargeted to SMB by changing a drive-letter mapping.
    let mount: Vec<u16> = format!("{}:\\\0", drive as char).encode_utf16().collect();
    let mut volume = [0u16; 64];
    if unsafe {
        GetVolumeNameForVolumeMountPointW(mount.as_ptr(), volume.as_mut_ptr(), volume.len() as u32)
    } == 0
    {
        return Err("Only mounted local volumes are supported.".into());
    }
    let length = volume
        .iter()
        .position(|c| *c == 0)
        .ok_or("Invalid local volume path")?;
    let mut current = PathBuf::from(OsString::from_wide(&volume[..length]));
    let names = parts
        .map(|part| match part {
            Component::Normal(name) => Ok(name),
            _ => Err("The path must be normalized before opening.".to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut parents = Vec::new();
    let mut file = open_component(&current, true)?;
    for (index, name) in names.iter().enumerate() {
        parents.push(file);
        current.push(name);
        let leaf = index + 1 == names.len();
        #[cfg(test)]
        if leaf {
            BEFORE_LEAF.with(|hook| {
                if let Some(hook) = hook.borrow_mut().take() {
                    hook();
                }
            });
        }
        file = open_component(&current, !leaf || directory)?;
    }
    Ok(PinnedFile {
        file,
        _parents: parents,
        disk_path: current,
    })
}

pub(super) fn entries(file: &PinnedFile) -> Result<std::fs::ReadDir, String> {
    std::fs::read_dir(&file.disk_path).map_err(|e| e.to_string())
}

#[cfg(windows)]
pub(super) fn path(file: &PinnedFile) -> Result<PathBuf, String> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    let mut buffer = vec![0u16; 32_768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if length == 0 || length as usize >= buffer.len() {
        return Err("Could not resolve the opened file.".into());
    }
    Ok(PathBuf::from(OsString::from_wide(
        &buffer[..length as usize],
    )))
}

#[cfg(not(windows))]
pub(super) fn open(_: &Path, _: bool) -> Result<PinnedFile, String> {
    Err("No-follow handle-bound file access is not yet available on this platform.".into())
}
#[cfg(not(windows))]
pub(super) fn path(_: &PinnedFile) -> Result<PathBuf, String> {
    Err("No-follow handle-bound file access is not yet available on this platform.".into())
}

#[cfg(all(test, windows))]
thread_local! {
    static BEFORE_LEAF: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
}
#[cfg(all(test, windows))]
pub(super) fn before_leaf(hook: impl FnOnce() + 'static) {
    BEFORE_LEAF.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}
