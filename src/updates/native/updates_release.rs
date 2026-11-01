//! Choosing the release to offer from the GitHub API's release list.
use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct Release {
    pub version: semver::Version,
    pub notes: String,
    pub page: String,
    /// (name, download url) of this platform's installer.
    pub asset: Option<(String, String)>,
    /// Download url of the installer's minisign signature (`<asset>.sig`).
    pub signature_url: Option<String>,
}

/// Installers the release build produces for this platform and CPU, best first. Each
/// names the architecture, so an arm64 installer is never offered to an x64 machine.
pub fn installer_suffixes() -> &'static [&'static str] {
    let arm = std::env::consts::ARCH == "aarch64";
    match (std::env::consts::OS, arm) {
        ("windows", false) => &["_x64-setup.exe"],
        ("windows", true) => &["_arm64-setup.exe"],
        ("macos", false) => &["_x64.dmg"],
        ("macos", true) => &["_aarch64.dmg"],
        (_, false) => &["_amd64.AppImage", "_amd64.deb", ".x86_64.rpm"],
        (_, true) => &["_aarch64.AppImage", "_arm64.deb", ".aarch64.rpm"],
    }
}

fn parse_tag(tag: &str) -> Option<semver::Version> {
    let version = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag)).ok()?;
    // Stable channel only: release candidates and other pre-releases are not offered.
    version.pre.is_empty().then_some(version)
}

/// The newest published, stable release built from `branch`, with this platform's
/// installer and its signature when present.
///
/// `target_commitish` is where the release points, not proof of how it was built;
/// the signature check at install time is what establishes trust.
pub fn pick_release(releases: &Value, branch: &str, suffixes: &[&str]) -> Option<Release> {
    let (version, release) = releases
        .as_array()?
        .iter()
        .filter(|r| r["draft"] != true && r["prerelease"] != true)
        .filter(|r| r["target_commitish"].as_str() == Some(branch))
        .filter_map(|r| Some((parse_tag(r["tag_name"].as_str()?)?, r)))
        .max_by(|a, b| a.0.cmp(&b.0))?;
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let url_of = |name: &str| {
        assets
            .iter()
            .find(|a| a["name"].as_str() == Some(name))
            .and_then(|a| a["browser_download_url"].as_str().map(String::from))
    };
    // Suffixes in priority order, whatever order the release lists its assets in.
    let asset = suffixes
        .iter()
        .find_map(|suffix| {
            assets
                .iter()
                .filter_map(|a| a["name"].as_str())
                .find(|name| name.ends_with(suffix))
        })
        .and_then(|name| Some((name.to_string(), url_of(name)?)));
    let signature_url = asset
        .as_ref()
        .and_then(|(name, _)| url_of(&format!("{name}.sig")));
    Some(Release {
        version,
        notes: release["body"].as_str().unwrap_or_default().to_string(),
        page: release["html_url"].as_str().unwrap_or_default().to_string(),
        asset,
        signature_url,
    })
}

/// Downloads only come from GitHub's own hosts.
pub fn trusted_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://objects.githubusercontent.com/")
}
