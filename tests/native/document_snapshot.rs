use super::*;

#[test]
fn snapshots_preserve_bytes_and_refuse_oversized_files_before_reading() {
    let dir = std::env::temp_dir().join(format!("cairngorm-snapshot-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("Review final 日本語.DOCX");
    fs::write(&path, [0x50, 0x4b, 3, 4, 0, 255]).unwrap();
    assert_eq!(
        read_snapshot(&path, 1024).unwrap(),
        vec![0x50, 0x4b, 3, 4, 0, 255]
    );
    let error = read_snapshot(&path, 4).unwrap_err();
    assert!(error.contains("too large"), "{error}");
    let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(manifest::HOST_MAX_BYTES + 1).unwrap();
    drop(file);
    let error = read_snapshot(&path, u64::MAX).unwrap_err();
    assert!(error.contains("32 MiB"), "{error}");
    assert_eq!(
        fs::metadata(&path).unwrap().len(),
        manifest::HOST_MAX_BYTES + 1
    );
    assert!(read_snapshot(&dir, 1024).is_err());
    assert!(read_snapshot(&dir.join("missing"), 1024).is_err());
    let _ = fs::remove_dir_all(&dir);
}
