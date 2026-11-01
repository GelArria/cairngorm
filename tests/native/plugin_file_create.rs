use super::*;
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;

fn blank(extension: &str) -> Result<(Vec<u8>, String), String> {
    match extension {
        "xlsx" => Ok((b"PK blank".to_vec(), "Spreadsheet editor".into())),
        other => Err(format!("No document provider can create .{other} files.")),
    }
}

#[test]
fn creates_new_documents_inside_the_project_and_never_overwrites() {
    let scratch = fixture::Scratch::new();
    let root = ProjectScope::new(&scratch.root()).unwrap();
    let ok = || Ok(());
    let (path, provider) = write_new(&root, "reports/2026/sales.xlsx", &blank, &ok).unwrap();
    assert_eq!(provider, "Spreadsheet editor");
    assert_eq!(std::fs::read(&path).unwrap(), b"PK blank");
    assert!(path.ends_with("reports/2026/sales.xlsx"));
    let code = |requested: &str| write_new(&root, requested, &blank, &ok).unwrap_err().code;
    assert_eq!(code("reports/2026/sales.xlsx"), "already-exists");
    assert_eq!(std::fs::read(&path).unwrap(), b"PK blank");
    assert_eq!(code("../outside/new.xlsx"), "outside-project");
    assert_eq!(code("notes"), "invalid-path");
    assert_eq!(code("diagram.pages"), "no-template");
    // A revoked scope stops before anything is written.
    let revoked = || Err(FileError::new("scope-revoked", "revoked"));
    let error = write_new(&root, "late.xlsx", &blank, &revoked).unwrap_err();
    assert_eq!(error.code, "scope-revoked");
    assert!(!scratch.root().join("late.xlsx").exists());
}
