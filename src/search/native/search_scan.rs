// Per-file matching for workspace search. One whole-buffer `is_match` rejects
// the (vast) majority of files before any line splitting or allocation; only
// files with a hit are walked line by line. Long lines (minified bundles) are
// cut to a snippet around the match so a single hit can't ship a 500 KB line.
use regex::Regex;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_MATCHES_PER_FILE: usize = 100;
const SNIPPET_BEFORE: usize = 48;
const SNIPPET_AFTER: usize = 200;
const SNIPPET_MAX_MATCH: usize = 300;
const BINARY_SNIFF: usize = 8 * 1024;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub col: usize,
    /// Snippet of the line around the match (whole line when short).
    pub line_text: String,
    /// UTF-16 offsets into `line_text` — what JS `String.slice` expects.
    pub match_start: usize,
    pub match_end: usize,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

/// Search regex. `(?mR)` keeps `^`/`$` line-anchored (CRLF-aware) when the whole
/// file is pre-filtered in one pass, so the prefilter never rejects a per-line hit.
pub fn build_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Regex, String> {
    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if whole_word {
        format!(r"\b(?:{})\b", pattern)
    } else {
        pattern
    };
    let flags = if case_sensitive { "(?mR)" } else { "(?mRi)" };
    Regex::new(&format!("{}{}", flags, pattern)).map_err(|e| e.to_string())
}

/// UTF-8 text of a searchable file, or None (unreadable, too big, binary, not UTF-8).
pub fn read_text(path: &Path, max_size: u64) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > max_size {
        return None;
    }
    let mut bytes = Vec::new();
    // Bound reads too: an indexed file can grow between metadata and read.
    file.take(max_size.saturating_add(1))
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > max_size {
        return None;
    }
    if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}
fn ceil_boundary(s: &str, mut i: usize) -> usize {
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// (snippet, match_start, match_end) with UTF-16 offsets into the snippet.
fn snippet(line: &str, start: usize, end: usize) -> (String, usize, usize) {
    let end = ceil_boundary(line, end.min(start + SNIPPET_MAX_MATCH));
    let from = floor_boundary(line, start.saturating_sub(SNIPPET_BEFORE));
    let to = ceil_boundary(line, end.saturating_add(SNIPPET_AFTER).min(line.len()));
    let prefix = if from > 0 { "…" } else { "" };
    let lead = utf16_len(prefix) + utf16_len(&line[from..start]);
    let text = format!("{}{}", prefix, &line[from..to]);
    (text, lead, lead + utf16_len(&line[start..end]))
}

pub fn scan_file(
    path: &Path,
    text: &str,
    re: &Regex,
    cancel: &AtomicBool,
    context_lines: usize,
) -> Vec<SearchMatch> {
    if cancel.load(Ordering::Relaxed) || !re.is_match(text) {
        return Vec::new();
    }
    let path_str = path.to_string_lossy().to_string();
    // The default search streams lines and stops at the cap without indexing
    // the entire file. Only context requests need random access to neighbours.
    let lines: Vec<&str> = if context_lines > 0 {
        text.lines().collect()
    } else {
        Vec::new()
    };
    let mut results = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for m in re.find_iter(line) {
            let (line_text, match_start, match_end) = snippet(line, m.start(), m.end());
            let (context_before, context_after) = if context_lines > 0 {
                let before = lines[idx.saturating_sub(context_lines)..idx]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();
                let after = lines
                    [idx + 1..(idx + 1).saturating_add(context_lines).min(lines.len())]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();
                (before, after)
            } else {
                (Vec::new(), Vec::new())
            };
            results.push(SearchMatch {
                path: path_str.clone(),
                line: idx + 1,
                col: m.start() + 1,
                line_text,
                match_start,
                match_end,
                context_before,
                context_after,
            });
            if results.len() >= MAX_MATCHES_PER_FILE {
                return results;
            }
        }
    }
    results
}

#[cfg(test)]
#[path = "../../../tests/native/search-scan.rs"]
mod regression_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_keeps_short_lines_whole() {
        let (t, s, e) = snippet("let foo = 1;", 4, 7);
        assert_eq!((t.as_str(), s, e), ("let foo = 1;", 4, 7));
    }

    #[test]
    fn snippet_offsets_are_utf16() {
        let line = "λword = foo";
        let start = line.find("foo").unwrap();
        let (t, s, e) = snippet(line, start, start + 3);
        let u: Vec<u16> = t.encode_utf16().collect();
        assert_eq!(String::from_utf16(&u[s..e]).unwrap(), "foo");
    }

    #[test]
    fn snippet_cuts_long_lines_around_match() {
        let line = format!("{}needle{}", "a".repeat(10_000), "b".repeat(10_000));
        let start = line.find("needle").unwrap();
        let (t, s, e) = snippet(&line, start, start + 6);
        assert!(t.len() < 400);
        let u: Vec<u16> = t.encode_utf16().collect();
        assert_eq!(String::from_utf16(&u[s..e]).unwrap(), "needle");
    }

    #[test]
    fn line_anchors_survive_the_whole_file_prefilter() {
        let re = build_regex("^bar", true, false, true).unwrap();
        let hits = scan_file(
            Path::new("x"),
            "foo\nbar\n",
            &re,
            &AtomicBool::new(false),
            0,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        let re = build_regex("bar$", true, false, true).unwrap();
        assert_eq!(
            scan_file(
                Path::new("x"),
                "bar\r\nfoo\r\n",
                &re,
                &AtomicBool::new(false),
                0
            )
            .len(),
            1
        );
    }
}
