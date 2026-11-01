import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("checks out source with Prettier line endings and preserves binary assets", () => {
  const files = [
    "src/app/main.tsx",
    "scripts/build-agent.mjs",
    "tests/unit/repository-hygiene.test.ts",
    "scripts/ci/smoke-linux.sh",
    "README.md",
    "tests/manual/windows/click.ps1",
    "src/documents/providers/spreadsheet/blank.xlsx",
  ];
  const result = execFileSync("git", ["check-attr", "-z", "eol", "text", "--", ...files], {
    encoding: "utf8",
  });
  const attributes = result.split("\0");
  const actual: Record<string, Record<string, string>> = {};
  for (let i = 0; i < attributes.length - 1; i += 3) {
    const [file, attribute, value] = attributes.slice(i, i + 3);
    (actual[file] ??= {})[attribute] = value;
  }
  for (const file of files.slice(0, 5)) {
    expect(actual[file].eol, file).toBe("lf");
  }
  expect(actual[files[5]].eol).toBe("crlf");
  expect(actual[files[6]].text).toBe("unset");
});

it("ignores local artifacts without hiding required build inputs", () => {
  const localArtifacts = [
    ".env",
    ".env.local",
    "src/agent/core/.env.local",
    ".claude/settings.local.json",
    ".codex/config.toml",
    ".pi/session.json",
    ".plan.md",
    "docs/handoffs/private-notes.md",
    "node_modules/example/index.js",
    "src/agent/core/node_modules/example/index.js",
    "dist/index.html",
    "src/agent/core/dist/cli.js",
    "src-tauri/target/debug/cairngorm.exe",
    "src/app/cli/target/debug/cairngorm-cli.exe",
    "src-tauri/binaries/cairngorm-agent.exe",
    "src-tauri/gen/schemas/windows-schema.json",
    "logs/e2e/screenshot.png",
    "src-tauri/logs/debug.log",
    ".e2e/cache/session.json",
    "playwright/.auth/session.json",
    "test-results/report.json",
    "playwright-report/index.html",
    "coverage/index.html",
    "references/example/source.ts",
    "signing.pfx",
    "private.pem",
    "crash.dmp",
    "tsconfig.tsbuildinfo",
    "scratch.tmp",
    "source.ts.bak",
    "nul",
  ];
  const buildInputs = [
    ".env.example",
    "src/agent/core/.env.example",
    "package-lock.json",
    "src/agent/core/package-lock.json",
    "src/agent/core/bun.lock",
    "src-tauri/Cargo.lock",
    "src-tauri/resources/conpty/OpenConsole.exe",
    "src-tauri/resources/conpty/conpty.dll",
    "src-tauri/migrations/001_init.sql",
    "src-tauri/icons/icon.png",
    "src/assets/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf",
    "src/documents/providers/spreadsheet/blank.xlsx",
    "src/documents/sdk/generated/document-sdk.js",
    "tests/e2e/fixtures/imgcat.png",
    "licenses/WRY-MIT.txt",
    "docs/architecture.md",
    "docs/media/workspace.png",
    "docs/media/website.svg",
  ];
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    input: [...localArtifacts, ...buildInputs].join("\n") + "\n",
    encoding: "utf8",
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim().split(/\r?\n/).sort()).toEqual(localArtifacts.sort());
});
