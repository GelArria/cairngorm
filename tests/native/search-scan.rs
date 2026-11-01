use super::*;

#[test]
fn context_and_streaming_paths_return_identical_match_locations() {
    let text = "before\r\n🦀 foo foo\r\nafter\r\nlast";
    let re = build_regex("foo", true, false, false).unwrap();
    let cancel = AtomicBool::new(false);
    let plain = scan_file(Path::new("unicode.txt"), text, &re, &cancel, 0);
    let context = scan_file(Path::new("unicode.txt"), text, &re, &cancel, 2);
    assert_eq!(plain.len(), 2);
    for (a, b) in plain.iter().zip(&context) {
        assert_eq!(
            (
                &a.path,
                a.line,
                a.col,
                &a.line_text,
                a.match_start,
                a.match_end
            ),
            (
                &b.path,
                b.line,
                b.col,
                &b.line_text,
                b.match_start,
                b.match_end
            )
        );
        assert!(a.context_before.is_empty() && a.context_after.is_empty());
        assert_eq!(b.context_before, ["before"]);
        assert_eq!(b.context_after, ["after", "last"]);
    }
}

#[test]
fn capped_and_cancelled_searches_preserve_existing_limits() {
    let text = "needle\n".repeat(300_000);
    let re = build_regex("needle", true, false, false).unwrap();
    let hits = scan_file(
        Path::new("large.txt"),
        &text,
        &re,
        &AtomicBool::new(false),
        0,
    );
    assert_eq!(hits.len(), MAX_MATCHES_PER_FILE);
    assert_eq!(hits.last().unwrap().line, MAX_MATCHES_PER_FILE);
    assert!(scan_file(
        Path::new("large.txt"),
        &text,
        &re,
        &AtomicBool::new(true),
        0
    )
    .is_empty());
    let hits = scan_file(
        Path::new("small.txt"),
        "needle\nlast",
        &re,
        &AtomicBool::new(false),
        usize::MAX,
    );
    assert_eq!(hits[0].context_after, ["last"]);
}

#[test]
fn read_text_keeps_size_binary_and_utf8_guards() {
    let root = std::env::temp_dir().join(format!("cairngorm-scan-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let file = root.join("sample.txt");
    fs::write(&file, "🦀").unwrap();
    assert_eq!(read_text(&file, 4).as_deref(), Some("🦀"));
    assert!(read_text(&file, 3).is_none());
    fs::write(&file, b"a\0b").unwrap();
    assert!(read_text(&file, 3).is_none());
    fs::write(&file, [255]).unwrap();
    assert!(read_text(&file, 3).is_none());
    fs::write(&file, "").unwrap();
    assert_eq!(read_text(&file, 0).as_deref(), Some(""));
    assert!(read_text(&root.join("missing"), 100).is_none());
    assert!(read_text(&root, 100).is_none());
    fs::remove_dir_all(root).unwrap();
}
