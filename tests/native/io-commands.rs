// Real async command roundtrips: cargo test --manifest-path src-tauri/Cargo.toml --lib io_commands
use crate::{fs_cmds, git, git_history};
use std::fs;
use std::path::PathBuf;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("cairngorm-io-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn root(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
    fn path(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn file_commands_preserve_content_order_and_errors() {
    let dir = Scratch::new();
    fs::create_dir(dir.0.join("z-folder")).unwrap();
    tauri::async_runtime::block_on(async {
        fs_cmds::fs_write_file(dir.path("b.txt"), "hello 🦀".into())
            .await
            .unwrap();
        fs_cmds::fs_write_file(dir.path("A.txt"), "a".into())
            .await
            .unwrap();
        assert_eq!(
            fs_cmds::fs_read_file(dir.path("b.txt")).await.unwrap(),
            "hello 🦀"
        );
        assert!(fs_cmds::fs_exists(dir.path("b.txt")).await.unwrap());
        assert!(!fs_cmds::fs_exists(dir.path("missing")).await.unwrap());
        let entries =
            serde_json::to_value(fs_cmds::fs_list_dir(dir.root()).await.unwrap()).unwrap();
        let names: Vec<_> = entries
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["z-folder", "A.txt", "b.txt"]);
        assert_eq!(entries[0]["isDirectory"], true);
        assert!(fs_cmds::fs_list_dir(dir.path("missing"))
            .await
            .err()
            .unwrap()
            .contains("Not a directory"));
        assert!(fs_cmds::fs_read_file(dir.root())
            .await
            .unwrap_err()
            .contains("Is a directory"));
        assert!(fs_cmds::fs_read_file(dir.path("missing")).await.is_err());
        fs::write(dir.0.join("pixel.PNG"), [0, 1, 2, 255]).unwrap();
        assert_eq!(
            fs_cmds::fs_read_file_data_url(dir.path("pixel.PNG"))
                .await
                .unwrap(),
            "data:image/png;base64,AAEC/w=="
        );
        assert!(fs_cmds::fs_read_file_data_url(dir.path("missing"))
            .await
            .is_err());
    });
}

#[test]
fn git_reads_preserve_history_diffs_and_no_repo_behavior() {
    let dir = Scratch::new();
    tauri::async_runtime::block_on(async {
        let root = dir.root();
        assert_eq!(git::git_repo_root(root.clone()).await.unwrap(), None);
        assert_eq!(git::git_branch(root.clone()).await.unwrap_err(), "no-repo");
        assert_eq!(
            git_history::git_log(root.clone(), 8, None)
                .await
                .err()
                .unwrap(),
            "no-repo"
        );
        assert_eq!(
            git_history::git_file_details(root.clone())
                .await
                .err()
                .unwrap(),
            "no-repo"
        );
        assert_eq!(
            git_history::git_diff(root.clone(), "file.txt".into(), "unstaged".into())
                .await
                .unwrap_err(),
            "no-repo"
        );
        assert!(git::git_init(root.clone()).await.error.is_none());
        fs::write(dir.0.join("file.txt"), "before\n").unwrap();
        git::git(&dir.0, &["add", "--", "file.txt"]).unwrap();
        git::git(
            &dir.0,
            &[
                "-c",
                "user.name=Cairngorm Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "core.hooksPath=",
                "commit",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        assert_eq!(
            git::git_repo_root(root.clone()).await.unwrap(),
            Some(root.clone())
        );
        assert!(!git::git_branch(root.clone()).await.unwrap().is_empty());
        let log = git_history::git_log(root.clone(), 8, None).await.unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "initial");
        let details = git_history::git_file_details(root.clone()).await.unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].path, "file.txt");
        fs::write(dir.0.join("file.txt"), "after\n").unwrap();
        let diff = git_history::git_diff(root.clone(), "file.txt".into(), "unstaged".into())
            .await
            .unwrap();
        assert!(diff.contains("-before") && diff.contains("+after"));
        assert!(
            git_history::git_diff(root, "file.txt".into(), "staged".into())
                .await
                .unwrap()
                .is_empty()
        );
    });
}
