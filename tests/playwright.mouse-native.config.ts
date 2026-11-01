import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "terminal-mouse-replay-native.spec.ts",
  outputDir: "../logs/e2e/terminal-mouse-replay-results",
  metadata: { nativeMouseReplay: true },
  workers: 1,
  timeout: 30000,
  use: { trace: "retain-on-failure" },
});
