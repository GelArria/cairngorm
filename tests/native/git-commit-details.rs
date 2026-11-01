use crate::{
    git,
    git_commit_details::{details, file_diff},
};
use std::{fs, path::PathBuf};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn reads_full_message_root_rename_binary_and_first_parent_merge() {
    let dir = Scratch(
        std::env::temp_dir().join(format!("cairngorm-commit-detail-{}", uuid::Uuid::new_v4())),
    );
    fs::create_dir_all(&dir.0).unwrap();
    let root = dir.0.to_string_lossy().to_string();
    let run = |args: &[&str]| git::git(&dir.0, args).unwrap();
    run(&["init", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Test Author"),
        ("user.email", "dev@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run(&["config", k, v]);
    }
    fs::write(
        dir.0.join("first file.txt"),
        "initial content\nsecond line\n",
    )
    .unwrap();
    run(&["add", "."]);
    run(&[
        "commit",
        "-m",
        "initial subject",
        "-m",
        "Full body\n\nAnother paragraph",
    ]);
    let initial = run(&["rev-parse", "HEAD"]).trim().to_string();
    let info = details(&root, &initial[..8]).unwrap();
    assert_eq!(info.hash, initial);
    assert_eq!(info.author, "Test Author");
    assert_eq!(info.email, "dev@example.invalid");
    assert!(info.message.contains("Full body\n\nAnother paragraph"));
    assert!(info.refs.iter().any(|r| r.contains("main")));
    assert_eq!(info.files.len(), 1);
    assert_eq!(info.files[0].added, Some(2));
    assert!(file_diff(&root, &initial, "first file.txt", None)
        .unwrap()
        .contains("+initial content"));
    assert!(details(&root, "--all").is_err());
    assert!(details(&root, "HEAD").is_err());
    assert!(file_diff(&root, &initial, "", None).is_err());
    run(&["mv", "first file.txt", "renamed file.txt"]);
    fs::write(dir.0.join("binary.bin"), [0, 1, 2, 0, 3]).unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "rename and binary"]);
    let changed = run(&["rev-parse", "HEAD"]).trim().to_string();
    let info = details(&root, &changed).unwrap();
    let renamed = info
        .files
        .iter()
        .find(|f| f.path == "renamed file.txt")
        .unwrap();
    assert!(renamed.status.starts_with('R'));
    assert_eq!(renamed.old_path.as_deref(), Some("first file.txt"));
    assert_eq!(renamed.added, Some(0));
    let patch = file_diff(&root, &changed, &renamed.path, renamed.old_path.as_deref()).unwrap();
    assert!(patch.contains("rename from first file.txt"));
    let binary = info.files.iter().find(|f| f.path == "binary.bin").unwrap();
    assert_eq!(binary.added, None);
    assert!(file_diff(&root, &changed, &binary.path, None)
        .unwrap()
        .contains("Binary files"));
    // Reads historical content, not whatever currently lives in the worktree.
    fs::write(
        dir.0.join("renamed file.txt"),
        "UNCOMMITTED SECRET CONTENT\n",
    )
    .unwrap();
    assert!(!file_diff(&root, &initial, "first file.txt", None)
        .unwrap()
        .contains("SECRET"));
    assert!(file_diff(&root, &initial, "../outside", None).is_err());
    run(&["restore", "renamed file.txt"]);
    run(&["switch", "-c", "side"]);
    fs::write(dir.0.join("side.txt"), "side\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "side"]);
    run(&["switch", "main"]);
    fs::write(dir.0.join("main.txt"), "main\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "main"]);
    run(&["merge", "--no-ff", "side", "-m", "merge side"]);
    let merged = run(&["rev-parse", "HEAD"]).trim().to_string();
    let info = details(&root, &merged).unwrap();
    assert_eq!(info.files.len(), 1);
    assert_eq!(info.files[0].path, "side.txt");
    assert!(file_diff(&root, &merged, "side.txt", None)
        .unwrap()
        .contains("+side"));
    assert!(run(&["status", "--porcelain"]).is_empty());
}
