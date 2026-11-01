fn main() {
    // The agent sidecar is named after the Rust target (see scripts/build-agent.mjs).
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap()
    );
    // portable-pty automatically loads conpty.dll beside the executable.
    // The inbox Windows host drops TUI mouse modes enabled before raw input.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        assert_eq!(
            std::env::var("CARGO_CFG_TARGET_ARCH").unwrap(),
            "x86_64",
            "Bundled ConPTY is x64; provide matching Microsoft binaries for other Windows targets"
        );
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let profile = out.ancestors().nth(3).unwrap();
        for name in ["conpty.dll", "OpenConsole.exe"] {
            let source = std::path::Path::new("resources/conpty").join(name);
            println!("cargo:rerun-if-changed={}", source.display());
            for directory in [profile.to_path_buf(), profile.join("deps")] {
                let dest = directory.join(name);
                std::fs::create_dir_all(&directory).unwrap();
                if let Err(e) = std::fs::copy(&source, &dest) {
                    // A running dev app locks its DLL; identical content in place is fine.
                    if std::fs::read(&source).ok().as_deref()
                        != std::fs::read(&dest).ok().as_deref()
                    {
                        panic!("cannot copy {} -> {}: {e}. Source must exist; if locked, close the running app",
                               source.display(), dest.display());
                    }
                }
            }
        }
    }
    tauri_build::build()
}
