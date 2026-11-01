use super::{check, install, release, CHANNEL};
use base64::Engine;
use serde_json::{json, Value};

fn release(tag: &str, branch: &str, flags: (bool, bool), assets: Value) -> Value {
    json!({
        "tag_name": tag,
        "target_commitish": branch,
        "draft": flags.0,
        "prerelease": flags.1,
        "body": format!("notes {tag}"),
        "html_url": format!("https://github.com/o/r/releases/{tag}"),
        "assets": assets,
    })
}

fn installer(version: &str) -> Value {
    let name = format!("Cairngorm_{version}_x64-setup.exe");
    json!([
        { "name": name, "browser_download_url": format!("https://github.com/dl/{name}") },
        { "name": format!("{name}.sig"), "browser_download_url": format!("https://github.com/dl/{name}.sig") },
    ])
}

const STABLE: (bool, bool) = (false, false);

#[test]
fn picks_the_newest_stable_release_on_the_channel_branch() {
    let releases = json!([
        release("v0.3.0", "feature/x", STABLE, installer("0.3.0")),
        release("v0.2.0", "main", STABLE, installer("0.2.0")),
        release("v0.4.0", "main", (true, false), installer("0.4.0")),
        release("v0.5.0", "main", (false, true), installer("0.5.0")),
        release("v0.6.0-rc.1", "main", STABLE, installer("0.6.0-rc.1")),
        release("vv0.9.0", "main", STABLE, installer("0.9.0")),
        release("v0.1.5", "main", STABLE, installer("0.1.5")),
    ]);
    let pick = release::pick_release(&releases, "main", &["_x64-setup.exe"]).unwrap();
    assert_eq!(pick.version, semver::Version::new(0, 2, 0));
    assert_eq!(
        pick.asset.unwrap().1,
        "https://github.com/dl/Cairngorm_0.2.0_x64-setup.exe"
    );
    assert_eq!(
        pick.signature_url.as_deref(),
        Some("https://github.com/dl/Cairngorm_0.2.0_x64-setup.exe.sig")
    );
}

#[test]
fn a_release_without_this_platform_s_installer_has_no_asset() {
    let assets =
        json!([{ "name": "Cairngorm.dmg", "browser_download_url": "https://github.com/x.dmg" }]);
    let releases = json!([release("v1.0.0", "main", STABLE, assets)]);
    let pick = release::pick_release(&releases, "main", &["_x64-setup.exe"]).unwrap();
    assert!(pick.asset.is_none() && pick.signature_url.is_none());
    assert!(release::pick_release(&json!([]), "main", &[".exe"]).is_none());
}

#[test]
fn downloads_only_come_from_github() {
    assert!(release::trusted_url(
        "https://github.com/o/r/releases/download/v1/a.exe"
    ));
    assert!(release::trusted_url(
        "https://objects.githubusercontent.com/x"
    ));
    assert!(!release::trusted_url("http://github.com/o/r/a.exe"));
    assert!(!release::trusted_url(
        "https://github.com.evil.example/a.exe"
    ));
    assert!(!release::trusted_url("https://example.com/a.exe"));
}

/// Tauri's format: base64 of the minisign public key file and of the `.sig` file.
fn signed(data: &[u8]) -> (String, String) {
    let minisign::KeyPair { pk, sk } = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let signature = minisign::sign(Some(&pk), &sk, std::io::Cursor::new(data), None, None).unwrap();
    let b64 = |text: String| base64::engine::general_purpose::STANDARD.encode(text);
    (
        b64(pk.to_box().unwrap().into_string()),
        b64(signature.into_string()),
    )
}

#[test]
fn installers_must_be_signed_by_the_release_key() {
    let installer = b"MZ pretend installer bytes";
    let (key, signature) = signed(installer);
    assert!(install::verify_signature(installer, &signature, &key).is_ok());
    // Tampered bytes, another key, garbage and a missing key are all refused.
    assert!(install::verify_signature(b"MZ tampered", &signature, &key).is_err());
    let (other_key, _) = signed(b"x");
    assert!(install::verify_signature(installer, &signature, &other_key).is_err());
    assert!(install::verify_signature(installer, "not base64!", &key).is_err());
    assert!(install::verify_signature(installer, &signature, "").is_err());
}

#[test]
fn staged_installers_get_fresh_unique_files() {
    let a = install::stage(b"one", ".exe").unwrap();
    let b = install::stage(b"two", ".exe").unwrap();
    assert_ne!(a, b);
    assert_eq!(std::fs::read(&a).unwrap(), b"one");
    assert!(a
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("cairngorm-setup-"));
    let _ = std::fs::remove_file(a);
    let _ = std::fs::remove_file(b);
}

#[test]
fn installer_suffixes_follow_priority_not_asset_order() {
    let assets = json!([
        { "name": "C_1.0.0_arm64-setup.exe", "browser_download_url": "https://github.com/arm" },
        { "name": "C_1.0.0_x64-setup.exe", "browser_download_url": "https://github.com/x64" },
    ]);
    let releases = json!([release("v1.0.0", "main", STABLE, assets)]);
    let pick = release::pick_release(&releases, "main", &["_x64-setup.exe"]).unwrap();
    assert_eq!(pick.asset.unwrap().1, "https://github.com/x64");
    // Every suffix for this machine names its architecture.
    let arch = if std::env::consts::ARCH == "aarch64" {
        ["arm64", "aarch64"]
    } else {
        ["x64", "amd64"]
    };
    assert!(release::installer_suffixes()
        .iter()
        .all(|s| arch.iter().any(|a| s.contains(a)) || s.contains("x86_64")));
}

#[test]
fn a_newer_download_replaces_the_staged_one_and_tampering_blocks_launch() {
    let first = install::stage(b"one", ".exe").unwrap();
    install::set_pending(first.clone(), "sig".into());
    let second = install::stage(b"two", ".exe").unwrap();
    install::set_pending(second.clone(), "sig".into());
    assert!(!first.exists(), "the previous installer is deleted");
    assert!(install::has_pending());
    // The signature does not verify, so nothing runs and the file is removed.
    install::launch_pending("");
    assert!(!install::has_pending() && !second.exists());
}

#[test]
fn one_install_at_a_time() {
    let first = install::InstallGuard::acquire().unwrap();
    assert!(install::InstallGuard::acquire().is_err());
    drop(first);
    assert!(install::InstallGuard::acquire().is_ok());
}

/// Fails on purpose the day the channel is turned on: update this test then.
#[test]
fn the_channel_is_off_until_published() {
    assert!(!CHANNEL.enabled);
    let status = check().unwrap();
    assert_eq!(status.state, "disabled");
    assert_eq!(status.current, env!("CARGO_PKG_VERSION"));
    assert!(!status.installable);
}
