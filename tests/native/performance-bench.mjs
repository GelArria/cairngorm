// node tests/native/performance-bench.mjs [baseline-ref] — no new app dependencies.
// Builds an isolated release harness from the real modules, offline; artifacts in logs/.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "logs/rust-performance/bench");
mkdirSync(path.join(out, "src"), { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.stderr}`);
  return result;
}
const baseline = process.argv[2] ?? "HEAD";
writeFileSync(
  path.join(out, "search-before.rs"),
  run("git", ["show", `${baseline}:src/search/native/search_scan.rs`]).stdout,
);
writeFileSync(
  path.join(out, "Cargo.toml"),
  `[package]
name = "cairngorm-performance-bench"
version = "0.0.0"
edition = "2021"
[dependencies]
regex = "=1.12.3"
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "1"
base64 = "=0.22.1"
`,
);
const rustPath = (p) => JSON.stringify(p.replaceAll("\\", "/"));
writeFileSync(
  path.join(out, "src/app/main.rs"),
  `#[allow(dead_code)]
#[path = ${rustPath(path.join(out, "search-before.rs"))}] mod before;
#[allow(dead_code)]
#[path = ${rustPath(path.join(root, "src/search/native/search_scan.rs"))}] mod after;
#[path = ${rustPath(path.join(root, "src/terminal/native/pty_output.rs"))}] mod output;
include!(${rustPath(path.join(root, "tests/native/performance-bench.rs"))});
`,
);
const result = run("cargo", [
  "run",
  "--offline",
  "--release",
  "--manifest-path",
  path.join(out, "Cargo.toml"),
]);
process.stdout.write(
  `Baseline: ${baseline}; release harness uses production Rust modules\n${result.stdout}`,
);
process.stderr.write(result.stderr);
