// "files to include / exclude" for workspace search — comma-separated globs.
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use std::path::Path;

/// "files to include / exclude" — comma-separated globs, VS Code style:
/// `*.ts` and `src` match at any depth (`**/` is implied), folders match their contents.
pub struct PathFilter {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
}

fn glob_set(spec: &str) -> Result<Option<GlobSet>, String> {
    let mut b = GlobSetBuilder::new();
    let mut any = false;
    for raw in spec.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let g = raw.replace('\\', "/");
        let g = g.trim_start_matches("./").trim_end_matches('/');
        let base = if g.starts_with('/') {
            g.trim_start_matches('/').to_string()
        } else if g.starts_with("**/") {
            g.to_string()
        } else {
            format!("**/{g}")
        };
        for pat in [base.clone(), format!("{base}/**")] {
            let glob = GlobBuilder::new(&pat)
                .case_insensitive(cfg!(windows))
                .build()
                .map_err(|e| format!("Invalid pattern \"{raw}\": {e}"))?;
            b.add(glob);
        }
        any = true;
    }
    if !any {
        return Ok(None);
    }
    b.build().map(Some).map_err(|e| e.to_string())
}

impl PathFilter {
    pub fn new(include: &str, exclude: &str) -> Result<Self, String> {
        Ok(Self {
            include: glob_set(include)?,
            exclude: glob_set(exclude)?,
        })
    }

    pub fn is_noop(&self) -> bool {
        self.include.is_none() && self.exclude.is_none()
    }

    pub fn accepts(&self, root: &Path, path: &Path) -> bool {
        let rel = path.strip_prefix(root).unwrap_or(path);
        if self.exclude.as_ref().map_or(false, |s| s.is_match(rel)) {
            return false;
        }
        self.include.as_ref().map_or(true, |s| s.is_match(rel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_globs_match_at_any_depth() {
        let root = Path::new("/r");
        let f = PathFilter::new("*.ts, docs", "**/*.test.ts").unwrap();
        assert!(f.accepts(root, Path::new("/r/src/a/b.ts")));
        assert!(f.accepts(root, Path::new("/r/docs/readme.md")));
        assert!(!f.accepts(root, Path::new("/r/src/a/b.tsx")));
        assert!(!f.accepts(root, Path::new("/r/src/a/b.test.ts")));
        assert!(PathFilter::new("", "").unwrap().is_noop());
        assert!(PathFilter::new("[", "").is_err());
    }
}
