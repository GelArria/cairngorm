//! Global skills: `SKILL.md` folders in each agent harness's personal skills directory.
//! A disabled skill keeps its folder but renames `SKILL.md` to `SKILL.md.disabled`, which
//! no harness loads, so turning it back on restores it exactly.
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const ENABLED: &str = "SKILL.md";
const DISABLED: &str = "SKILL.md.disabled";

/// Harness id, label and skills folder relative to the user's home.
const ROOTS: &[(&str, &str, &str)] = &[
    ("agents", "Agents", ".agents/skills"),
    ("claude", "Claude Code", ".claude/skills"),
    ("codex", "Codex", ".codex/skills"),
    ("opencode", "opencode", ".config/opencode/skills"),
    ("opencode", "opencode", ".config/opencode/skill"),
    ("opencode", "opencode", ".opencode/skills"),
    ("droid", "Droid", ".factory/skills"),
    ("cursor", "Cursor", ".cursor/skills"),
    ("copilot", "Copilot", ".copilot/skills"),
    ("gemini", "Gemini CLI", ".gemini/skills"),
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// Harness whose folder holds the skill's files.
    pub harness: &'static str,
    pub harness_name: &'static str,
    /// Other harness folders that link to the same files.
    pub linked_from: Vec<&'static str>,
    pub dir: String,
    pub file: String,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRoot {
    pub id: &'static str,
    pub name: &'static str,
    pub path: String,
    pub exists: bool,
}

fn home() -> PathBuf {
    PathBuf::from(crate::shells::home_dir())
}

fn root_paths(home: &Path) -> Vec<(&'static str, &'static str, PathBuf)> {
    ROOTS
        .iter()
        .map(|(id, name, rel)| (*id, *name, home.join(rel)))
        .collect()
}

/// `name:` and `description:` from YAML front matter, including folded (`>`/`|`) values.
pub fn front_matter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let body: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let field = |key: &str| -> Option<String> {
        let at = body
            .iter()
            .position(|l| l.strip_prefix(key).is_some_and(|r| r.starts_with(':')))?;
        let first = body[at][key.len() + 1..].trim();
        let value = if first.is_empty() || first.starts_with('>') || first.starts_with('|') {
            body[at + 1..]
                .iter()
                .take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.is_empty())
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            first.to_string()
        };
        let unquoted = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(&value);
        Some(unquoted.trim().to_string()).filter(|v| !v.is_empty())
    };
    (field("name"), field("description"))
}

/// Canonical Windows paths carry a `\\?\` prefix that users never type.
fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

fn read_skill(dir: &Path, harness: &'static str, harness_name: &'static str) -> Option<Skill> {
    let (file, enabled) = [(ENABLED, true), (DISABLED, false)]
        .iter()
        .map(|(f, on)| (dir.join(f), *on))
        .find(|(f, _)| f.is_file())?;
    let text = fs::read_to_string(&file).unwrap_or_default();
    let (name, description) = front_matter(&text);
    let folder = dir.file_name()?.to_string_lossy().into_owned();
    Some(Skill {
        name: name.unwrap_or(folder),
        description: description.unwrap_or_default(),
        harness,
        harness_name,
        linked_from: Vec::new(),
        dir: dir.to_string_lossy().into_owned(),
        file: file.to_string_lossy().into_owned(),
        enabled,
    })
}

/// Every skill once: a folder linked into several harnesses is listed under its target.
pub fn list(home: &Path) -> Vec<Skill> {
    let mut found: Vec<(PathBuf, Skill)> = Vec::new();
    let mut links: Vec<(PathBuf, &'static str)> = Vec::new();
    for (id, name, root) in root_paths(home) {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            let Ok(real) = fs::canonicalize(&dir) else {
                continue;
            };
            // Symlinks and Windows junctions both report a link target.
            if fs::read_link(&dir).is_ok() {
                links.push((real, id));
            } else if let Some((_, first)) = found.iter_mut().find(|(r, _)| *r == real) {
                // The whole skills folder is a link to another one: same files again.
                if first.harness != id && !first.linked_from.contains(&id) {
                    first.linked_from.push(id);
                }
            } else if let Some(skill) = read_skill(&dir, id, name) {
                found.push((real, skill));
            }
        }
    }
    for (real, id) in links {
        match found.iter_mut().find(|(r, _)| *r == real) {
            Some((_, skill)) if skill.harness != id && !skill.linked_from.contains(&id) => {
                skill.linked_from.push(id)
            }
            Some(_) => {}
            // A link whose target lives outside every skills folder is still a skill.
            None => {
                let name = ROOTS.iter().find(|r| r.0 == id).map_or(id, |r| r.1);
                if let Some(skill) = read_skill(&plain(&real), id, name) {
                    found.push((real, skill));
                }
            }
        }
    }
    let mut skills: Vec<Skill> = found.into_iter().map(|(_, s)| s).collect();
    skills.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.harness.cmp(b.harness))
    });
    skills
}

/// A skill folder that sits directly in a known skills folder (or is linked from one).
fn known_dir(home: &Path, dir: &Path) -> Result<PathBuf, String> {
    let real = fs::canonicalize(dir).map_err(|_| "Skill folder not found")?;
    let listed = list(home)
        .into_iter()
        .any(|s| fs::canonicalize(&s.dir).ok().as_ref() == Some(&real));
    if listed {
        Ok(real)
    } else {
        Err("This folder is not in a skills directory".into())
    }
}

pub fn set_enabled(home: &Path, dir: &Path, enabled: bool) -> Result<(), String> {
    let real = known_dir(home, dir)?;
    let (from, to) = if enabled {
        (DISABLED, ENABLED)
    } else {
        (ENABLED, DISABLED)
    };
    if real.join(from).is_file() && real.join(to).is_file() {
        return Err(format!(
            "Both {ENABLED} and {DISABLED} exist in this folder; keep one of them"
        ));
    }
    if real.join(to).is_file() {
        return Ok(());
    }
    fs::rename(real.join(from), real.join(to)).map_err(|e| e.to_string())
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
        && !name.ends_with('-')
}

pub fn create(home: &Path, harness: &str, name: &str, description: &str) -> Result<Skill, String> {
    if !valid_name(name) {
        return Err("Use lowercase letters, digits and hyphens (up to 64 characters)".into());
    }
    let description = description.trim().replace(['\r', '\n'], " ");
    if description.is_empty() {
        return Err("Describe when an agent should use this skill".into());
    }
    let (id, label, root) = root_paths(home)
        .into_iter()
        .find(|(id, _, _)| *id == harness)
        .ok_or("Unknown skills folder")?;
    let dir = root.join(name);
    if dir.exists() {
        return Err(format!("A skill named \"{name}\" already exists there"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let quoted = serde_json::to_string(&description).map_err(|e| e.to_string())?;
    let text = format!(
        "---\nname: {name}\ndescription: {quoted}\n---\n\n# {name}\n\nDescribe the steps the agent should follow.\n"
    );
    fs::write(dir.join(ENABLED), text).map_err(|e| e.to_string())?;
    read_skill(&dir, id, label).ok_or_else(|| "The skill could not be read back".into())
}

#[tauri::command]
pub async fn skills_list() -> Result<Vec<Skill>, String> {
    crate::blocking(|| list(&home())).await
}

#[tauri::command]
pub async fn skills_roots() -> Result<Vec<SkillRoot>, String> {
    crate::blocking(|| {
        let mut seen: Vec<&str> = Vec::new();
        root_paths(&home())
            .into_iter()
            .filter(|(id, _, _)| {
                let first = !seen.contains(id);
                seen.push(id);
                first
            })
            .map(|(id, name, path)| SkillRoot {
                id,
                name,
                exists: path.is_dir(),
                path: path.to_string_lossy().into_owned(),
            })
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn skills_set_enabled(dir: String, enabled: bool) -> Result<Vec<Skill>, String> {
    crate::blocking(move || {
        let home = home();
        set_enabled(&home, Path::new(&dir), enabled)?;
        Ok(list(&home))
    })
    .await?
}

#[tauri::command]
pub async fn skills_create(
    harness: String,
    name: String,
    description: String,
) -> Result<Skill, String> {
    crate::blocking(move || create(&home(), &harness, &name, &description)).await?
}

#[cfg(test)]
#[path = "../../../tests/native/skills.rs"]
mod tests;
