// Compiles the `cairngorm` terminal command (src/app/cli) for the app bundle:
// - Windows: the installer puts it in `<install>\bin` and adds that folder to the user PATH;
// - macOS: it ships in Cairngorm.app/Contents/MacOS as `cairngorm-cli` (an external binary).
// Linux packages run the app itself as `cairngorm`, so there it is skipped.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function hostTriple() {
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return /^host: (\S+)$/m.exec(info)[1];
}

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const windows = triple.includes("windows");
if (!windows && !triple.includes("apple-darwin")) {
  console.log(`Terminal command: not bundled for ${triple}`);
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(root, "src-tauri/target/cli");
execFileSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    join(root, "src/app/cli/Cargo.toml"),
    "--target",
    triple,
    "--target-dir",
    targetDir,
  ],
  { stdio: "inherit" },
);
const ext = windows ? ".exe" : "";
const out = join(root, "src-tauri/binaries", `cairngorm-cli-${triple}${ext}`);
mkdirSync(dirname(out), { recursive: true });
copyFileSync(join(targetDir, triple, `release/cairngorm-cli${ext}`), out);
console.log(`Terminal command: ${out}`);
