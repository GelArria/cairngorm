import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(here, "..", "logs", "test-results"),
  testMatch: ["terminal-edge-cases.spec.ts", "terminal-split-flows.spec.ts"],
  timeout: 600000, // 10 minutes per test (long flows)
  retries: 0,
  use: {
    trace: "on-first-retry",
  },
  // No webServer - we connect to the running Tauri app via CDP
});
