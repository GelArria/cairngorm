import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import config from "../playwright.config";
import preview from "../playwright.preview.config";
import resize from "../playwright.resize.config";
import isolation from "../playwright.isolation.config";

const require = createRequire(import.meta.url);

it("mocked Playwright selection excludes native suites even with inherited opt-ins", () => {
  const output = execFileSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "-c",
      "tests/playwright.config.ts",
      "--list",
      "--reporter=json",
    ],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        E2E_REAL: "1",
        CAIRNGORM_RESTORE_EXE: "must-not-start.exe",
        CAIRNGORM_PLUGIN_ISOLATION: JSON.stringify({ origins: [], policy: "" }),
      },
    },
  );
  const report = JSON.parse(output);
  expect(report.errors).toEqual([]);
  const selected = report.suites.map((suite: { file: string }) => path.basename(suite.file));
  expect(selected).toContain("app-menu.spec.ts");
  for (const file of fs.readdirSync("tests/e2e").filter((file) => file.endsWith(".spec.ts"))) {
    const source = fs.readFileSync(path.join("tests/e2e", file), "utf8");
    if (/connectOverCDP|terminal-native-fixture|E2E_REAL|CAIRNGORM_PLUGIN_ISOLATION/.test(source)) {
      expect(selected, `${file} needs an explicit native config`).not.toContain(file);
    }
  }
}, 30000);

it("mocked preview and resize keep the same native-suite exclusions", () => {
  expect(preview.testMatch).toEqual(config.testMatch);
  expect(preview.testIgnore).toEqual(config.testIgnore);
  expect(preview.webServer).toBeUndefined();
  expect(resize.testMatch).toEqual(config.testMatch);
  expect(resize.testIgnore).toEqual(config.testIgnore);
});

it("the Rust storage-isolation fixture keeps a dedicated browser entry point", () => {
  expect(isolation.testMatch).toBe("plugin-isolation.spec.ts");
  expect(isolation.testIgnore).toBeUndefined();
  expect(isolation.webServer).toBeUndefined();
  expect(fs.readFileSync("tests/native/plugin_isolation.rs", "utf8")).toContain(
    '"tests/playwright.isolation.config.ts"',
  );
});
