// Build an inventory and checksums from actual bundle outputs, never from credentials.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const target = process.argv[2];
if (!target || !/^[a-z0-9_-]+$/.test(target)) {
  throw new Error("Pass a Rust target triple");
}
const root = resolve(import.meta.dirname, "..");
const output = join(root, "logs/release-evidence", target);
mkdirSync(output, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [label, cwd] of [
  ["frontend", root],
  ["agent", join(root, "src/agent/core")],
]) {
  const sbom = execFileSync(npm, ["sbom", "--sbom-format=cyclonedx", "--omit=dev"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  JSON.parse(sbom);
  writeFileSync(join(output, `${label}.cdx.json`), sbom);
}
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--format-version=1", "--locked", "--manifest-path", "src-tauri/Cargo.toml"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  ),
);
writeFileSync(
  join(output, "native.cdx.json"),
  JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      components: metadata.packages.map((pkg) => ({
        type: "library",
        name: pkg.name,
        version: pkg.version,
        purl: `pkg:cargo/${pkg.name}@${pkg.version}`,
        ...(pkg.license ? { licenses: [{ expression: pkg.license }] } : {}),
      })),
    },
    null,
    2,
  ),
);
function bundles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory()
      ? bundles(path)
      : /\.(exe|dmg|deb|rpm|AppImage)$/.test(item.name)
        ? [path]
        : [];
  });
}
if (process.argv.includes("--inventory-only")) {
  console.log(`Dependency inventories: ${relative(root, output)}`);
  process.exit(0);
}
const files = bundles(join(root, "src-tauri/target", target, "release/bundle"));
if (!files.length) {
  throw new Error("No installer artifacts found");
}
writeFileSync(
  join(output, "SHA256SUMS"),
  files
    .sort()
    .map(
      (file) =>
        `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${relative(root, file).replaceAll("\\", "/")}`,
    )
    .join("\n") + "\n",
);
console.log(`Release evidence: ${relative(root, output)}`);
