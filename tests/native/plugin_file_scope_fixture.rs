use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) struct Scratch(pub(super) PathBuf);
impl Scratch {
    pub(super) fn new() -> Self {
        let base =
            std::env::temp_dir().join(format!("cairngorm-file-scope-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join("project with spaces/Unicode-校验")).unwrap();
        fs::create_dir_all(base.join("project with spaces-other")).unwrap();
        fs::create_dir_all(base.join("outside")).unwrap();
        fs::write(
            base.join("project with spaces/Unicode-校验/notes.txt"),
            b"original\r\nbytes",
        )
        .unwrap();
        fs::write(base.join("outside/secret.txt"), b"not authorized").unwrap();
        fs::write(
            base.join("project with spaces-other/sibling.txt"),
            b"sibling",
        )
        .unwrap();
        Self(base)
    }
    pub(super) fn root(&self) -> PathBuf {
        self.0.join("project with spaces")
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

pub(super) fn directory_link(target: &Path, link: &Path) {
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(target, link)
        .expect("Native file-scope tests require permission to create directory symlinks");
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
}
