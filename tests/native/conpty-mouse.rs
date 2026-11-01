// Targeted native regression: fresh Pi renderer, no existing raw-mode recorder.
#[test]
#[ignore = "requires installed Pi TUI; run explicitly on Windows"]
fn fresh_pi_mouse_modes_reach_the_frontend() {
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use std::{
        io::{Read, Write},
        sync::{mpsc, Arc, Mutex},
        time::Duration,
    };
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let module = std::env::var_os("PI_TUI_TEST_MODULE").map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::PathBuf::from(std::env::var_os("APPDATA").unwrap()).join("npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js")
    });
    assert!(
        module.exists(),
        "Set PI_TUI_TEST_MODULE to the installed Pi TUI entrypoint"
    );
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut cmd = CommandBuilder::new("node.exe");
    cmd.arg(root.join("tests/e2e/fixtures/pi-mouse-probe.mjs"));
    cmd.arg(module);
    for key in ["PATH", "SystemRoot", "USERPROFILE", "TEMP", "TMP"] {
        if let Ok(value) = std::env::var(key) {
            cmd.env(key, value);
        }
    }
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    let writer = Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
    let mut reader = pair.master.try_clone_reader().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut raw = Vec::new();
        let mut bytes = [0u8; 8192];
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 {
                break;
            }
            raw.extend_from_slice(&bytes[..n]);
            if bytes[..n].windows(4).any(|w| w == b"\x1b[6n") {
                let _ = writer.lock().unwrap().write_all(b"\x1b[1;1R");
            }
            if raw.windows(17).any(|w| w == b"PI-TRANSCRIPT 000") {
                break;
            }
        }
        let _ = tx.send(raw);
    });
    let output = rx.recv_timeout(Duration::from_secs(10));
    let _ = child.kill();
    let _ = child.wait();
    let raw = output.expect("Pi renderer did not produce output");
    assert!(
        raw.windows(8).any(|w| w == b"\x1b[?1006h"),
        "ConPTY swallowed Pi's SGR mouse-mode request"
    );
    assert!(
        raw.windows(8).any(|w| w == b"\x1b[?1003h"),
        "ConPTY swallowed Pi's mouse-tracking request"
    );
}
