// Compiles the agent sidecar for the Rust target being bundled. Tauri finds
// sidecars as `binaries/cairngorm-agent-<target triple>[.exe]`.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun cross-compiles from any host; Rust triples map onto its target names.
const BUN_TARGETS = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
};

function hostTriple() {
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return /^host: (\S+)$/m.exec(info)[1];
}

// `tauri build --target <triple>` exports the triple to beforeBuildCommand.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const bunTarget = BUN_TARGETS[triple];
if (!bunTarget) {
  console.error(`No Bun target for ${triple}. Add it to scripts/build-agent.mjs.`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "src/agent/core");
const ext = triple.includes("windows") ? ".exe" : "";
const out = join(root, "src-tauri/binaries", `cairngorm-agent-${triple}${ext}`);
mkdirSync(dirname(out), { recursive: true });

const run = (args) => execFileSync("bun", args, { cwd: core, stdio: "inherit" });
run(["install", "--frozen-lockfile"]);
run(["build", "src/cli.ts", "--compile", `--target=${bunTarget}`, "--outfile", out]);
console.log(`Agent sidecar: ${out}`);
