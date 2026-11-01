// The command reports the app's version, read from the Tauri config so it never drifts.
fn main() {
    let config = "../../../src-tauri/tauri.conf.json";
    println!("cargo:rerun-if-changed={config}");
    let text = std::fs::read_to_string(config).expect("src-tauri/tauri.conf.json must exist");
    let version = text
        .lines()
        .find_map(|line| {
            let rest = line.trim().strip_prefix("\"version\":")?;
            Some(
                rest.trim()
                    .trim_end_matches(',')
                    .trim_matches('"')
                    .to_string(),
            )
        })
        .expect("tauri.conf.json has a version");
    println!("cargo:rustc-env=CAIRNGORM_VERSION={version}");
}
