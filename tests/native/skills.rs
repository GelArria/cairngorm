use super::*;

fn temp_home(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cairngorm-skills-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn reads_plain_quoted_and_folded_front_matter() {
    let (n, d) = front_matter("---\nname: one\ndescription: \"Says hi\"\n---\nbody");
    assert_eq!((n.as_deref(), d.as_deref()), (Some("one"), Some("Says hi")));
    let (_, d) = front_matter("---\nname: two\ndescription: >\n  first line\n  second\n---\n");
    assert_eq!(d.as_deref(), Some("first line second"));
    assert_eq!(front_matter("# no front matter"), (None, None));
}

#[test]
fn creates_lists_disables_and_enables_skills() {
    let home = temp_home("cycle");
    assert!(create(&home, "claude", "Bad Name", "x").is_err());
    let skill = create(&home, "claude", "my-skill", "Use it\nwisely").unwrap();
    assert_eq!(skill.description, "Use it wisely");
    assert!(create(&home, "claude", "my-skill", "again").is_err());
    let listed = list(&home);
    assert_eq!(listed.len(), 1);
    assert!(listed[0].enabled);
    set_enabled(&home, Path::new(&listed[0].dir), false).unwrap();
    let listed = list(&home);
    assert!(!listed[0].enabled);
    assert!(listed[0].file.ends_with("SKILL.md.disabled"));
    set_enabled(&home, Path::new(&listed[0].dir), true).unwrap();
    assert!(list(&home)[0].enabled);
    let outside = home.join("elsewhere");
    fs::create_dir_all(&outside).unwrap();
    assert!(set_enabled(&home, &outside, false).is_err());
    let _ = fs::remove_dir_all(&home);
}

#[cfg(windows)]
#[test]
fn a_linked_skills_folder_lists_and_toggles_the_shared_skill_once() {
    let home = temp_home("linked-root");
    create(&home, "agents", "shared-skill", "Shared").unwrap();
    fs::create_dir_all(home.join(".claude")).unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(home.join(".claude").join("skills"))
        .arg(home.join(".agents").join("skills"))
        .output()
        .unwrap();
    assert!(status.status.success());
    let listed = list(&home);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].linked_from, vec!["claude"]);
    let original = fs::read(&listed[0].file).unwrap();
    let linked = home.join(".claude/skills/shared-skill");
    let target = home.join(".agents/skills/shared-skill");
    set_enabled(&home, &linked, false).unwrap();
    assert!(!linked.join("SKILL.md").exists());
    assert!(!target.join("SKILL.md").exists());
    assert_eq!(
        fs::read(target.join("SKILL.md.disabled")).unwrap(),
        original
    );
    let disabled = list(&home);
    assert_eq!(disabled.len(), 1);
    assert!(!disabled[0].enabled);
    assert_eq!(disabled[0].linked_from, vec!["claude"]);
    set_enabled(&home, &target, true).unwrap();
    assert_eq!(fs::read(linked.join("SKILL.md")).unwrap(), original);
    assert!(!target.join("SKILL.md.disabled").exists());
    assert!(list(&home)[0].enabled);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn refuses_to_toggle_when_both_files_exist() {
    let home = temp_home("both");
    let skill = create(&home, "claude", "dup", "Dup").unwrap();
    fs::write(Path::new(&skill.dir).join("SKILL.md.disabled"), "x").unwrap();
    assert!(set_enabled(&home, Path::new(&skill.dir), false).is_err());
    let _ = fs::remove_dir_all(&home);
}
