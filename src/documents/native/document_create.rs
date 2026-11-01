//! New documents for agents: a provider that declares a `template` for an extension supplies
//! the blank file. Included providers are preferred over ones the user installed.
use super::{bundled, install};
use std::{fs, path::Path};

const EXECUTABLE: &[&str] = &[
    "exe",
    "com",
    "scr",
    "pif",
    "msi",
    "msp",
    "lnk",
    "url",
    "vbs",
    "vbe",
    "wsf",
    "wsh",
    "hta",
    "jar",
    "reg",
    "cpl",
    "dll",
    "sys",
    "appref-ms",
    "application",
    "scf",
    "inf",
    "chm",
];

/// The blank file for `extension` and the name of the provider that will open it.
pub fn template(extension: &str) -> Result<(Vec<u8>, String), String> {
    let app = super::open::APP
        .get()
        .ok_or("Cairngorm is still starting.")?;
    let root = super::root(app)?;
    if bundled::refresh_once(&root) {
        use tauri::Emitter;
        let _ = app.emit("document-providers-changed", ());
    }
    template_in(&root, extension)
}

pub(super) fn template_in(root: &Path, extension: &str) -> Result<(Vec<u8>, String), String> {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    // Documents only: never let a provider template become something Windows runs.
    if EXECUTABLE.contains(&extension.as_str()) {
        return Err(format!(".{extension} files cannot be created by agents."));
    }
    let mut candidates: Vec<_> = install::list(root)
        .into_iter()
        .filter_map(|installed| installed.manifest)
        .filter_map(|manifest| {
            let template = manifest
                .file_types
                .iter()
                .find(|t| t.extensions.contains(&extension))?
                .template
                .clone()?;
            Some((manifest, template))
        })
        .collect();
    candidates.sort_by_key(|(manifest, _)| !bundled::reserved(&manifest.id));
    let (manifest, template) = candidates.into_iter().next().ok_or_else(|| {
        format!("No document provider can create .{extension} files. Install one that can, or create the file another way.")
    })?;
    let path = root.join(&manifest.id).join(&template);
    let bytes =
        fs::read(&path).map_err(|e| format!("Could not read the blank .{extension}: {e}"))?;
    if bytes.len() as u64 > manifest.max_bytes {
        return Err("The provider's template is too large.".into());
    }
    Ok((bytes, manifest.name))
}

#[cfg(test)]
mod tests {
    #[test]
    fn included_spreadsheet_editor_creates_blank_workbooks() {
        let root =
            std::env::temp_dir().join(format!("cairngorm-template-{}", uuid::Uuid::new_v4()));
        assert!(super::template_in(&root, "xlsx").is_err());
        super::bundled::refresh(&root);
        let (bytes, name) = super::template_in(&root, ".XLSX").unwrap();
        assert_eq!(&bytes[..2], b"PK");
        assert_eq!(name, "Spreadsheet editor");
        assert!(super::template_in(&root, "EXE")
            .unwrap_err()
            .contains("cannot be created"));
        assert!(super::template_in(&root, "pages")
            .unwrap_err()
            .contains("No document provider"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
