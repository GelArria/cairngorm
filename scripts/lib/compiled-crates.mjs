// The crates the app actually compiles: `cargo tree` over every target platform with
// normal and build edges and the default features. `cargo metadata` alone also lists
// crates behind features nobody enables (such as sqlx's MySQL driver).
import { execFileSync } from "node:child_process";

export function compiledCrates(root) {
  const run = (args) =>
    execFileSync("cargo", [...args, "--manifest-path", "src-tauri/Cargo.toml", "--locked"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 128 << 20,
    });
  const tree = run([
    "tree",
    "--target",
    "all",
    "-e",
    "normal,build",
    "--prefix",
    "none",
    "--format",
    "{p}",
  ]);
  const compiled = new Set(
    tree
      .split(/\r?\n/)
      .map((line) => /^(\S+) v(\S+)/.exec(line))
      .filter(Boolean)
      .map(([, name, version]) => `${name}@${version}`),
  );
  const metadata = JSON.parse(run(["metadata", "--format-version=1"]));
  const own = new Set(metadata.workspace_members);
  return metadata.packages.filter(
    (pkg) => !own.has(pkg.id) && compiled.has(`${pkg.name}@${pkg.version}`),
  );
}
