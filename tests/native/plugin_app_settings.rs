use super::*;

fn app(id: &str, prog_id: &str, executable: &str) -> App {
    App {
        id: id.into(),
        name: id.into(),
        prog_id: prog_id.into(),
        executable: executable.into(),
        mcp: None,
    }
}

fn exe() -> String {
    std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

#[test]
fn settings_hide_detected_apps_and_add_valid_ones_only() {
    let exe = exe();
    let detected = vec![
        app("excel", "Excel.Application", &exe),
        app("onenote", "OneNote.Application", &exe),
    ];
    let section = serde_json::json!({
        "hide": ["onenote"],
        "add": [
            { "id": "photoshop", "name": "Photoshop", "progId": "Photoshop.Application", "executable": exe },
            { "id": "bad", "name": "Bad", "progId": "X'); Remove-Item", "executable": exe },
            { "id": "missing", "name": "Missing", "progId": "M.Application", "executable": "C:/nope/none.exe" },
            { "id": "relative", "name": "Relative", "progId": "R.Application", "executable": "tool.exe" },
            { "id": "excel", "name": "Duplicate", "progId": "Excel.Application", "executable": exe }
        ]
    });
    let ids: Vec<String> = with_config(detected, &section)
        .into_iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, ["excel", "photoshop"]);
}

#[test]
fn a_hidden_detected_id_cannot_be_redirected_to_another_program() {
    let exe = exe();
    let detected = vec![app("excel", "Excel.Application", &exe)];
    let section = serde_json::json!({
        "hide": ["excel"],
        "add": [
            { "id": "excel", "name": "Microsoft Excel", "progId": "Other.Application", "executable": exe },
            { "id": "shell", "name": "Shell", "progId": "Shell.Application", "executable": exe },
            { "id": "explorer", "name": "Explorer", "progId": "Explorer.Application",
              "executable": format!("{}\\explorer.exe", std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())) }
        ]
    });
    assert!(with_config(detected, &section).is_empty());
}

#[test]
fn added_applications_are_approved_under_what_they_point_to() {
    let exe = exe();
    let detected = vec![app("excel", "Excel.Application", &exe)];
    // macOS approvals also name the bundle, so another bundle never inherits them.
    let expected = if cfg!(target_os = "macos") {
        "excel@Excel.Application"
    } else {
        "excel"
    };
    assert_eq!(consent_key(&detected[0], &detected), expected);
    assert_eq!(consent_label(&detected[0], &detected), "excel");
    let added = app("photoshop", "Photoshop.Application", &exe);
    let moved = app("photoshop", "Other.Application", &exe);
    let key = consent_key(&added, &detected);
    assert!(key.starts_with("photoshop#") && key.len() == "photoshop".len() + 13);
    assert_ne!(key, consent_key(&moved, &detected));
    assert!(consent_label(&added, &detected).ends_with("(from cairngorm.json)"));
}
