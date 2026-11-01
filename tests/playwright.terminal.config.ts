import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  testDir: "./e2e",
  testMatch: "terminal-input-parity.spec.ts",
  outputDir: path.join(here, "../logs/e2e/terminal-parity-results"),
  metadata: { nativeTerminal: true },
  workers: 1,
  timeout: 30000,
  use: { trace: "retain-on-failure" },
  // Native WebView2 over CDP; no browser server and no mocked Tauri APIs.
});
