// Run: node tests/native/pty-ring-bench.mjs (requires rustc; no extra dependencies).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(path.join(root, "src/terminal/native/pty.rs"), "utf8");
const start = source.indexOf("fn push_ring(");
const end = source.indexOf("\npub struct PtySession", start);
if (start < 0 || end < 0) throw new Error("Cannot locate the real PTY ring implementation");
const out = path.join(root, "logs/optimization");
mkdirSync(out, { recursive: true });
const rs = path.join(out, "pty-ring-bench.rs");
const exe = path.join(out, process.platform === "win32" ? "pty-ring-bench.exe" : "pty-ring-bench");
writeFileSync(
  rs,
  `
#[allow(unused_imports)]
use std::collections::VecDeque;
use std::hint::black_box;
use std::time::Instant;
${source.slice(start, end)}
fn vec_baseline(buf: &mut Vec<u8>, data: &[u8], cap: usize) {
    buf.extend_from_slice(data);
    if buf.len() > cap { let excess = buf.len() - cap; buf.drain(..excess); }
}
fn main() {
    // Compare every update to the previous implementation, including wrapping,
    // oversize chunks, empty input and a zero-sized buffer.
    for cap in [0, 1, 8, 257, 262144] {
        let mut actual = Default::default();
        let mut expected = Vec::new();
        for n in 0..1000 {
            let data: Vec<u8> = (0..(n * 73 % 513)).map(|i| (i + n) as u8).collect();
            push_ring(&mut actual, &data, cap);
            vec_baseline(&mut expected, &data, cap);
            assert_eq!(actual.iter().copied().collect::<Vec<_>>(), expected);
            assert!(actual.len() <= cap);
        }
    }
    println!("ring correctness: 5000 updates passed (including zero/oversize/wrap)");
    let data = vec![42u8; 4096];
    let cap = 256 * 1024;
    let mut old_times = Vec::new();
    let mut new_times = Vec::new();
    for _ in 0..7 {
        let mut old = vec![0u8; cap];
        let mut new = Default::default();
        push_ring(&mut new, &vec![0u8; cap], cap);
        let start = Instant::now();
        for _ in 0..20480 { vec_baseline(black_box(&mut old), black_box(&data), cap); }
        old_times.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        for _ in 0..20480 { push_ring(black_box(&mut new), black_box(&data), cap); }
        new_times.push(start.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(new.iter().copied().collect::<Vec<_>>(), old);
    }
    old_times.sort_by(f64::total_cmp);
    new_times.sort_by(f64::total_cmp);
    println!("80 MiB / 4 KiB chunks / 256 KiB history, median of 7 (rustc -O)");
    println!("Vec baseline: {:.2} ms; current: {:.2} ms; ratio: {:.2}x", old_times[3], new_times[3], old_times[3] / new_times[3]);
}
`,
);
for (const [command, args] of [
  ["rustc", ["--edition=2021", "-O", rs, "-o", exe]],
  [exe, []],
]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
