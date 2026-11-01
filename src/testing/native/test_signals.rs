use super::types::{Signal, Status, TestResult};
use regex::Regex;
use std::sync::LazyLock;

macro_rules! re {
    ($pattern:literal) => {{
        static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new($pattern).unwrap());
        &*RE
    }};
}
fn counts(line: &str) -> [Option<usize>; 3] {
    let mut out = [None; 3];
    for (i, regex) in [
        re!(r"(?i)(\d+)\s+pass(?:ed)?\b"),
        re!(r"(?i)(\d+)\s+fail(?:ed|ure|ures)?\b"),
        re!(r"(?i)(\d+)\s+(?:skip(?:ped)?|todo|ignored|deselected)\b"),
    ]
    .iter()
    .enumerate()
    {
        for m in regex.captures_iter(line) {
            out[i] = Some(
                out[i]
                    .unwrap_or(0usize)
                    .saturating_add(m[1].parse::<usize>().unwrap_or(0)),
            );
        }
    }
    out
}
fn result(name: &str, status: &str) -> Signal {
    Signal {
        result: Some(TestResult {
            name: name.into(),
            status: match status {
                "failed" | "FAIL" | "FAILED" | "fail" | "not ok" => Status::Failed,
                "skipped" | "SKIP" | "SKIPPED" | "skip" | "ignored" | "?" | "-" => Status::Skipped,
                _ => Status::Passed,
            },
        }),
        ..Signal::default()
    }
}
fn start(runner: &'static str, restart: bool, total: Option<usize>) -> Signal {
    Signal {
        start: true,
        runner: Some(runner),
        restart,
        total,
        ..Signal::default()
    }
}
fn summary(line: &str, reset: bool, failed: bool) -> Signal {
    Signal {
        counts: Some(counts(line)),
        reset_counts: reset,
        end: true,
        failed,
        ..Signal::default()
    }
}

pub fn signal(raw: &str, runner: Option<&str>) -> Signal {
    let line = raw.trim().trim_start_matches(['│', '┃']).trim_start();
    let accepts = |name| runner.is_none() || runner == Some("Tests") || runner == Some(name);
    if runner == Some("Go") && re!(r"^.*[$>#]\s*go\s+test\b").is_match(line) {
        return start("Go", true, None);
    }
    if accepts("Vitest") && line.starts_with("RERUN ") {
        return start("Vitest", true, None);
    }
    if re!(r"^(?:RUN|DEV)\s+v?\d[\w.-]*\s+\S").is_match(line) {
        return start("Vitest", false, None);
    }
    if let Some(m) = re!(r"^Running (\d+) tests? using \d+ workers?").captures(line) {
        return start("Playwright", false, m[1].parse().ok());
    }
    if re!(r"^=+\s*test session starts\s*=+").is_match(line) {
        return start("pytest", false, None);
    }
    if let Some(m) = re!(r"^running (\d+) tests?$").captures(line) {
        return start("Cargo", false, m[1].parse().ok());
    }
    if re!(r"^bun test v\d").is_match(line) {
        return start("Bun", false, None);
    }
    if re!(r"^TAP version \d+").is_match(line) {
        return start("Node", false, None);
    }
    if re!(r"^=== RUN\s+").is_match(line) {
        return start("Go", false, None);
    }
    if re!(r"^RUNS\s+\S").is_match(line) {
        return start("Jest", false, None);
    }
    if accepts("Cargo") {
        if re!(r"^Finished\s+.*\btest\b.*target\(s\)").is_match(line) {
            return start("Cargo", true, None);
        }
        if let Some(m) = re!(r"^(?:Running\s+(.+?)\s+\(target|Doc-tests\s+(.+))").captures(line) {
            return Signal {
                runner: Some("Cargo"),
                suite: Some(m.get(1).or(m.get(2)).unwrap().as_str().into()),
                ..Signal::default()
            };
        }
    }
    if (accepts("Vitest") && re!(r"^Test Files\s").is_match(line))
        || (accepts("Jest") && re!(r"^Test Suites:?\s").is_match(line))
    {
        return Signal {
            failed: re!(r"\d+ failed").is_match(line),
            ..Signal::default()
        };
    }
    if (accepts("Vitest") && re!(r"^Tests\s").is_match(line))
        || (accepts("Jest") && re!(r"^Tests:\s").is_match(line))
    {
        let mut s = summary(line, true, false);
        if s.counts.unwrap().iter().all(Option::is_none) {
            return Signal::default();
        }
        s.total = re!(r"\((\d+)\)|\b(\d+) total")
            .captures(line)
            .and_then(|m| m.get(1).or(m.get(2)))
            .and_then(|m| m.as_str().parse().ok())
            .or_else(|| {
                Some(
                    s.counts
                        .unwrap()
                        .iter()
                        .flatten()
                        .fold(0usize, |sum, n| sum.saturating_add(*n)),
                )
            });
        return s;
    }
    if accepts("Cargo") && re!(r"^test result: (?:ok|FAILED)\.").is_match(line) {
        return summary(line, true, line.contains("FAILED"));
    }
    if accepts("pytest")
        && re!(r"^=+.*\d+ (?:passed|failed|skipped|error).*\d.*(?:s|seconds)\s*=+$").is_match(line)
    {
        return summary(line, true, re!(r"\d+ (?:failed|errors?)").is_match(line));
    }
    if re!(r"^(?:No (?:test files|tests) found|Error: No tests found)").is_match(line) {
        return Signal {
            end: true,
            total: Some(0),
            failed: !line.contains("code 0"),
            ..Signal::default()
        };
    }
    if accepts("pytest") && re!(r"^=+\s*(?:no tests ran|\d+ errors?) .*\s*=+$").is_match(line) {
        return Signal {
            end: true,
            failed: true,
            ..Signal::default()
        };
    }
    if accepts("Playwright") && re!(r"^\d+ (?:passed|failed|skipped)(?:\s|\(|$)").is_match(line) {
        return summary(line, false, false);
    }
    if accepts("Bun") {
        if let Some(m) = re!(r"^Ran (\d+) tests? across ").captures(line) {
            return Signal {
                end: true,
                total: m[1].parse().ok(),
                ..Signal::default()
            };
        }
        if re!(r"^\d+ (pass|fail|skip)$").is_match(line) {
            return Signal {
                counts: Some(counts(line)),
                ..Signal::default()
            };
        }
    }
    if accepts("Node") {
        if let Some(m) = re!(r"^# (tests|pass|fail|skipped) (\d+)").captures(line) {
            let value = m[2].parse().unwrap_or(0);
            let mut s = Signal::default();
            match &m[1] {
                "tests" => s.total = Some(value),
                name => {
                    let mut c = [None; 3];
                    c[match name {
                        "pass" => 0,
                        "fail" => 1,
                        _ => 2,
                    }] = Some(value);
                    s.counts = Some(c);
                }
            }
            return s;
        }
        if line.starts_with("# duration_ms ") {
            return Signal {
                end: true,
                ..Signal::default()
            };
        }
    }
    if accepts("Go") {
        if let Some(m) = re!(
            r"^(ok|FAIL|\?)\s+(\S+)\s+(?:[\d.]+s|\(cached\)|\[no test files\]|\[build failed\])"
        )
        .captures(line)
        {
            let mut s = result(&m[2], &m[1]);
            s.runner = Some("Go");
            s.package = Some(m[2].into());
            s.end = true;
            s.failed = &m[1] == "FAIL";
            return s;
        }
        if line == "FAIL" {
            return Signal {
                runner: Some("Go"),
                end: true,
                failed: true,
                ..Signal::default()
            };
        }
    }
    if accepts("Vitest") && line.starts_with("PASS Waiting for file changes") {
        return Signal {
            end: true,
            ..Signal::default()
        };
    }
    if accepts("Jest") {
        if let Some(m) = re!(r"^(PASS|FAIL)\s+(.+\.(?:[cm]?[jt]sx?|py))(?:\s|$)").captures(line) {
            let mut s = result(&m[2], &m[1]);
            s.runner = Some("Jest");
            return s;
        }
    }
    if accepts("Cargo") {
        if let Some(m) = re!(r"^test (.+) \.{3} (ok|FAILED|ignored)").captures(line) {
            return result(&m[1], &m[2]);
        }
    }
    if accepts("Go") {
        if let Some(m) = re!(r"^--- (PASS|FAIL|SKIP): (.+?)(?: \([\d.]+s\))?$").captures(line) {
            return result(&m[2], &m[1]);
        }
    }
    if accepts("pytest") {
        if let Some(m) = re!(r"^(.+::\S+)\s+(PASSED|FAILED|SKIPPED)").captures(line) {
            return result(&m[1], &m[2]);
        }
    }
    if accepts("Bun") {
        if let Some(m) = re!(r"^\((pass|fail|skip)\)\s+(.+)").captures(line) {
            return result(&m[2], &m[1]);
        }
    }
    if accepts("Node") {
        if let Some(m) = re!(r"^(ok|not ok)\s+\d+\s+(?:- )?(.+)").captures(line) {
            return result(
                &m[2],
                if re!(r"# (?:SKIP|TODO)").is_match(line) {
                    "skipped"
                } else {
                    &m[1]
                },
            );
        }
    }
    if runner.is_none() || ["Tests", "Vitest", "Playwright", "Jest"].contains(&runner.unwrap_or(""))
    {
        if let Some(m) =
            re!(r"^[✓✔√×✗✘-]\s+(?:\d+\s+)?(.+?)(?:\s+\([\d.]+\s*m?s\))?$").captures(line)
        {
            if runner == Some("Vitest") && !re!(r"^\S+\.(?:[cm]?[jt]sx?)(?:\s|$)").is_match(&m[1]) {
                return Signal::default();
            }
            return result(
                &m[1],
                if line.starts_with(['×', '✗', '✘']) {
                    "failed"
                } else if line.starts_with('-') {
                    "skipped"
                } else {
                    "passed"
                },
            );
        }
    }
    Signal::default()
}
