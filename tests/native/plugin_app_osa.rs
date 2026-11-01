use super::*;

fn bundle(root: &Path, file: &str, keys: &str) {
    let contents = root.join(file).join("Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::write(
        contents.join("Info.plist"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>{keys}</dict></plist>"#
        ),
    )
    .unwrap();
}

#[test]
fn bundle_identifiers_become_short_ids() {
    assert_eq!(short_id("com.microsoft.Word"), "word");
    assert_eq!(short_id("com.apple.iWork.Keynote"), "keynote");
    assert_eq!(short_id("org.example.My App!"), "myapp");
    assert_eq!(short_id("com.figma.Desktop"), "figma-desktop");
    assert_eq!(short_id("notion.id"), "notion-id");
}

#[test]
fn only_bundles_with_a_scripting_dictionary_are_listed() {
    let root = std::env::temp_dir().join(format!("cairngorm-osa-{}", uuid::Uuid::new_v4()));
    let common = |id: &str, name: &str| {
        format!(
            "<key>CFBundleIdentifier</key><string>{id}</string>\
             <key>CFBundleName</key><string>{name}</string>\
             <key>CFBundleExecutable</key><string>{name}</string>"
        )
    };
    bundle(
        &root,
        "Microsoft Word.app",
        &format!(
            "{}<key>NSAppleScriptEnabled</key><true/>",
            common("com.microsoft.Word", "Microsoft Word")
        ),
    );
    bundle(
        &root,
        "Keynote.app",
        &format!(
            "{}<key>OSAScriptingDefinition</key><string>Keynote.sdef</string>",
            common("com.apple.iWork.Keynote", "Keynote")
        ),
    );
    bundle(
        &root,
        "Old.app",
        &format!(
            "{}<key>NSAppleScriptEnabled</key><string>YES</string>",
            common("org.old.Word", "Old Word")
        ),
    );
    bundle(&root, "Plain.app", &common("com.example.Plain", "Plain"));
    bundle(
        &root,
        "Off.app",
        &format!(
            "{}<key>NSAppleScriptEnabled</key><false/>",
            common("com.example.Off", "Off")
        ),
    );
    std::fs::create_dir_all(root.join("NotAnApp")).unwrap();
    let apps = scan_folders(&[root.clone(), root.join("missing")]);
    let ids: Vec<&str> = apps.iter().map(|app| app.id.as_str()).collect();
    assert_eq!(ids, ["keynote", "word", "org-old-word"], "{apps:?}");
    let word = &apps[1];
    assert_eq!(word.prog_id, "com.microsoft.Word");
    assert!(
        word.executable
            .replace('\\', "/")
            .ends_with("Contents/MacOS/Microsoft Word"),
        "{}",
        word.executable
    );
    let expected = if cfg!(windows) {
        "com"
    } else if cfg!(target_os = "macos") {
        "osa"
    } else {
        "none"
    };
    assert_eq!(word.driver(), expected);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn scripts_get_the_application_and_cannot_break_out_of_its_identifier() {
    let app = App {
        id: "word".into(),
        name: "Microsoft Word".into(),
        prog_id: "com.microsoft.Word".into(),
        executable: String::new(),
        mcp: None,
    };
    let program = wrap(&app, "print(app.name());");
    assert!(program.contains("const app = Application(\"com.microsoft.Word\");"));
    assert!(program.contains("(function () {\nprint(app.name());\n})();"));
    let hostile = App {
        prog_id: "x\"); doShellScript(\"rm".into(),
        ..app
    };
    assert!(wrap(&hostile, "").contains(r#"Application("x\"); doShellScript(\"rm")"#));
}
