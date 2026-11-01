//! Stands in for the app in the `cairngorm` command tests: writes the folder it started
//! in and each argument on its own line to CAIRNGORM_ECHO_OUT.
fn main() {
    let out = std::env::var_os("CAIRNGORM_ECHO_OUT").expect("CAIRNGORM_ECHO_OUT is set");
    let mut lines = vec![std::env::current_dir().unwrap().display().to_string()];
    lines.extend(std::env::args().skip(1));
    // Written whole, then renamed, so the test never reads a half-written file.
    let partial = std::path::PathBuf::from(&out).with_extension("partial");
    std::fs::write(&partial, lines.join("\n")).unwrap();
    std::fs::rename(partial, out).unwrap();
}
