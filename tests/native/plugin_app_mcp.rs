use super::*;

#[test]
fn commands_are_a_bare_program_and_its_arguments() {
    assert_eq!(
        command("photocraft-cli mcp"),
        Some(("photocraft-cli".into(), vec!["mcp".into()]))
    );
    assert_eq!(command("  tool  "), Some(("tool".into(), vec![])));
    assert_eq!(command(""), None);
    // Paths and shell syntax never reach a spawn.
    for line in [
        r"C:\Tools\x.exe mcp",
        "../x mcp",
        "/bin/sh -c",
        "x;y mcp",
        "a.exe mcp",
    ] {
        assert_eq!(command(line), None, "{line}");
    }
}

#[test]
fn every_craft_entry_declares_a_valid_mcp_command() {
    let crafts: Vec<_> = catalog::catalog()
        .iter()
        .filter(|plugin| plugin.category == "Craft apps")
        .collect();
    assert!(!crafts.is_empty());
    for plugin in crafts {
        let (program, args) = command(plugin.mcp).expect(plugin.id);
        assert_eq!(program, format!("{}-cli", plugin.id));
        assert_eq!(args, ["mcp"]);
    }
}

#[test]
fn catalog_ids_match_registered_apps_by_id_or_after_a_vendor_prefix() {
    use super::super::app_discovery::matches_catalog;
    assert!(matches_catalog("microsoft-word", "word"));
    assert!(matches_catalog("photocraft", "photocraft"));
    assert!(!matches_catalog("microsoft-word", "rd"));
    assert!(!matches_catalog("microsoft-word", "-word"));
    assert!(!matches_catalog("word", ""));
    assert!(!matches_catalog("libreoffice-writer", "word"));
}
