// Dependency audit: asks OSV (osv.dev, which carries the RustSec and GitHub advisory
// databases that `cargo audit` and `npm audit` use) about everything a release ships: the
// crates in the app's default build and the production npm packages of the app and the
// agent sidecar, from the committed lockfiles. Fails on any advisory that is not merely
// informational (unmaintained or unsound notices) unless scripts/audit-allowlist.json
// explains why it does not apply. Writes the full report to logs/audit/<date>/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compiledCrates } from "./lib/compiled-crates.mjs";

const root = resolve(import.meta.dirname, "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

function crates() {
  return compiledCrates(root)
    .filter((pkg) => pkg.source?.startsWith("registry+"))
    .map((pkg) => ({ ecosystem: "crates.io", name: pkg.name, version: pkg.version }));
}

function npmPackages(lockPath) {
  const lock = JSON.parse(git("show", `HEAD:${lockPath}`));
  return Object.entries(lock.packages ?? {})
    .filter(([path, info]) => path && !info.dev && !info.devOptional && !info.link && info.version)
    .map(([path, info]) => ({
      ecosystem: "npm",
      name: info.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
      version: info.version,
    }));
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function advisory(id) {
  const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(`OSV ${id}: HTTP ${response.status}`);
  }
  return response.json();
}

const unique = new Map();
for (const pkg of [
  ...crates(),
  ...npmPackages("package-lock.json"),
  ...npmPackages("src/agent/core/package-lock.json"),
]) {
  unique.set(`${pkg.ecosystem}:${pkg.name}@${pkg.version}`, pkg);
}
const packages = [...unique.values()];

const hits = [];
for (let i = 0; i < packages.length; i += 500) {
  const batch = packages.slice(i, i + 500);
  const { results } = await post("https://api.osv.dev/v1/querybatch", {
    queries: batch.map(({ ecosystem, name, version }) => ({
      package: { ecosystem, name },
      version,
    })),
  });
  results.forEach((result, index) => {
    for (const vuln of result.vulns ?? []) {
      hits.push({ pkg: batch[index], id: vuln.id });
    }
  });
}

const allowlist = JSON.parse(readFileSync(join(root, "scripts/audit-allowlist.json"), "utf8"));
const details = new Map();
for (const id of new Set(hits.map((hit) => hit.id))) {
  details.set(id, await advisory(id));
}

const lines = [];
const blocking = [];
const seen = new Set();
for (const { pkg, id } of hits.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))) {
  const vuln = details.get(id);
  // The same advisory can match under two ids (a RUSTSEC id and its GHSA alias).
  const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
  if (
    vuln.withdrawn ||
    [id, ...(vuln.aliases ?? [])].some((alias) => seen.has(`${key} ${alias}`))
  ) {
    continue;
  }
  seen.add(`${key} ${id}`);
  // RustSec marks unmaintained and unsound notices per affected package.
  const informational =
    vuln.database_specific?.informational ??
    (vuln.affected ?? [])
      .map((affected) => affected.database_specific?.informational)
      .find(Boolean);
  const fixed = (vuln.affected ?? [])
    .flatMap((affected) => affected.ranges ?? [])
    .flatMap((range) => range.events)
    .map((event) => event.fixed)
    .filter(Boolean);
  const allowed = allowlist[id];
  const status = informational ? `notice: ${informational}` : allowed ? "accepted" : "BLOCKING";
  lines.push(
    `${status.padEnd(20)} ${pkg.ecosystem} ${pkg.name} ${pkg.version}  ${id}` +
      `${vuln.aliases?.length ? ` (${vuln.aliases.join(", ")})` : ""}\n` +
      `${" ".repeat(21)}${vuln.summary ?? "(no summary)"}` +
      `${fixed.length ? ` — fixed in ${fixed.join(", ")}` : " — no fixed version"}` +
      `${allowed ? `\n${" ".repeat(21)}Accepted: ${allowed}` : ""}`,
  );
  if (!informational && !allowed) {
    blocking.push(`${pkg.name} ${pkg.version} ${id}`);
  }
}

const report = [
  `Dependency audit: ${packages.length} packages (crates.io and npm production), ` +
    `${hits.length} advisory matches, ${blocking.length} blocking.`,
  "",
  ...lines,
  "",
].join("\n");
const out = join(root, "logs/audit", new Date().toISOString().slice(0, 10));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "dependency-audit.txt"), report);
console.log(report);
if (blocking.length) {
  console.error(
    `Blocking advisories: update the dependency, or explain in scripts/audit-allowlist.json ` +
      `why it does not apply:\n  ${blocking.join("\n  ")}`,
  );
  process.exit(1);
}
