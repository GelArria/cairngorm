use super::args::{parse, Parsed, Request};
use super::*;

fn open(argv: &[&str]) -> Result<Request, String> {
    match parse(argv.iter().map(|arg| arg.to_string()))? {
        Parsed::Open(request) => Ok(request),
        other => panic!("expected a request, got {other:?}"),
    }
}

fn scratch() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cairngorm-launch-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("project")).unwrap();
    std::fs::write(dir.join("project").join("notes.md"), "notes").unwrap();
    std::fs::canonicalize(&dir).map(args_plain).unwrap()
}

fn args_plain(path: PathBuf) -> PathBuf {
    // The same form `resolve` returns, so paths compare equal on Windows.
    Request {
        path: Some(path.clone()),
        ..Request::default()
    }
    .resolve(&path, None)
    .unwrap()
    .path
    .unwrap()
}

#[test]
fn help_and_version_win_over_other_arguments() {
    let strings = |argv: &[&str]| argv.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    assert_eq!(parse(strings(&[".", "--help"])), Ok(Parsed::Help));
    assert_eq!(parse(strings(&["-h"])), Ok(Parsed::Help));
    assert_eq!(parse(strings(&["-v"])), Ok(Parsed::Version));
    assert_eq!(
        parse(strings(&["--version", "--bogus"])),
        Ok(Parsed::Version)
    );
    assert!(args::help("1.2.3").starts_with("Cairngorm 1.2.3\n"));
}

#[test]
fn options_combine_and_reject_mistakes() {
    let request = open(&["app", "-t", "-a", "claude", "--git", "--settings=providers"]).unwrap();
    assert_eq!(request.path, Some(PathBuf::from("app")));
    assert!(request.terminal);
    assert_eq!(request.agent.as_deref(), Some("claude"));
    assert_eq!(request.panel.as_deref(), Some("git"));
    assert_eq!(request.settings.as_deref(), Some("providers"));
    assert_eq!(
        open(&["--agent=codex"]).unwrap().agent.as_deref(),
        Some("codex")
    );
    assert_eq!(open(&["--settings"]).unwrap().settings.as_deref(), Some(""));
    assert_eq!(
        open(&["--", "-odd-folder"]).unwrap().path,
        Some(PathBuf::from("-odd-folder"))
    );

    for argv in [
        &["--bogus"][..],
        &["a", "b"],
        &["--agent"],
        &["--agent", "--git"],
        &["--agent=rm -rf"],
        &["--agent=../../evil"],
        &["-a", "."],
        &["-a", ".."],
        &["--git", "--files"],
        &["--terminal=yes"],
        &["--settings=../x"],
        &["-"],
    ] {
        assert!(open(argv).is_err(), "{argv:?} must be refused");
    }
    // The same panel twice is not a conflict.
    assert_eq!(
        open(&["--git", "--git"]).unwrap().panel.as_deref(),
        Some("git")
    );
}

#[test]
fn paths_resolve_against_the_callers_folder_and_must_exist() {
    let root = scratch();
    let project = root.join("project");
    let resolve = |argv: &[&str], cwd: &Path| open(argv).unwrap().resolve(cwd, Some(&root));

    assert_eq!(
        resolve(&["."], &project).unwrap().path,
        Some(project.clone())
    );
    assert_eq!(
        resolve(&["project"], &root).unwrap().path,
        Some(project.clone())
    );
    assert_eq!(
        resolve(&["~/project/notes.md"], &project).unwrap().path,
        Some(project.join("notes.md"))
    );
    // A terminal or an agent without a path opens where the command ran.
    assert_eq!(
        resolve(&["-a", "pi"], &project).unwrap().path,
        Some(project.clone())
    );
    assert_eq!(
        resolve(&["-t"], &project).unwrap().path,
        Some(project.clone())
    );
    // Settings and panels alone do not open a project.
    assert_eq!(resolve(&["--git"], &project).unwrap().path, None);
    // `..` and `.` are resolved without following links; a trailing separator is dropped.
    assert_eq!(
        resolve(&["project/../project/./"], &root).unwrap().path,
        Some(project.clone())
    );
    if cfg!(windows) {
        // Windows PowerShell 5.1 passes a completed `'project\'` as `project"`.
        assert_eq!(
            resolve(&["project\""], &root).unwrap().path,
            Some(project.clone())
        );
    }
    assert!(resolve(&["missing"], &project)
        .unwrap_err()
        .contains("No such file or folder: missing"));
    let shown = resolve(&["."], &project).unwrap().path.unwrap();
    assert!(!shown.to_string_lossy().starts_with(r"\\?\"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn forwarded_arguments_parse_back_to_the_same_request() {
    let root = scratch();
    let request = open(&[
        "project/notes.md",
        "-t",
        "-a",
        "codex",
        "--calendar",
        "--settings",
    ])
    .unwrap()
    .resolve(&root, None)
    .unwrap();
    let forwarded = request.to_args();
    assert_eq!(
        forwarded.last().map(String::as_str),
        Some(&*request.path.as_ref().unwrap().to_string_lossy())
    );
    let again = match parse(forwarded).unwrap() {
        Parsed::Open(again) => again.resolve(Path::new("/unused"), None).unwrap(),
        other => panic!("{other:?}"),
    };
    assert_eq!(again, request);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_app_queues_what_to_open_and_ignores_bad_or_empty_requests() {
    let root = scratch();
    let argv = |args: &[&str]| args.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    let file = request(argv(&["project/notes.md", "--files"]), &root).unwrap();
    assert!(file.is_file);
    assert_eq!(file.panel.as_deref(), Some("files"));
    let folder = request(argv(&["project", "-a", "claude"]), &root).unwrap();
    assert!(!folder.is_file);
    assert_eq!(folder.agent.as_deref(), Some("claude"));
    assert_eq!(request(argv(&[]), &root), None);
    assert_eq!(request(argv(&["--bogus"]), &root), None);
    assert_eq!(request(argv(&["missing"]), &root), None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminals_get_the_command_folder_on_path_once() {
    let (sep, dir) = if cfg!(windows) {
        (";", Path::new(r"C:\Apps\Cairngorm\bin"))
    } else {
        (":", Path::new("/opt/cairngorm/bin"))
    };
    let dir_text = dir.to_string_lossy().into_owned();
    assert_eq!(with_dir("", dir), dir_text);
    assert_eq!(with_dir("a", dir), format!("a{sep}{dir_text}"));
    let present = format!("a{sep}{dir_text}{}", std::path::MAIN_SEPARATOR);
    assert_eq!(with_dir(&present, dir), present);
    if cfg!(windows) {
        let upper = format!("a;{}", dir_text.to_uppercase());
        assert_eq!(with_dir(&upper, dir), upper);
    }
}

#[cfg(unix)]
#[test]
fn the_command_link_follows_the_current_install() {
    let root = scratch();
    let dir = root.join("bin");
    let (old, new) = (root.join("old-app"), root.join("new-app"));
    std::fs::write(&old, "").unwrap();
    std::fs::write(&new, "").unwrap();
    link_command(&dir, &old).unwrap();
    assert_eq!(std::fs::read_link(dir.join("cairngorm")).unwrap(), old);
    link_command(&dir, &old).unwrap();
    // A moved or updated app replaces the stale link.
    link_command(&dir, &new).unwrap();
    assert_eq!(std::fs::read_link(dir.join("cairngorm")).unwrap(), new);
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, ["cairngorm"], "no partial links are left behind");
    std::fs::remove_dir_all(root).unwrap();
}
