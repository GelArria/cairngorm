import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "workspace-native-restore.spec.ts",
  outputDir: "../logs/test-results/native-restore",
  workers: 1,
  timeout: 150000,
  expect: { timeout: 15000 },
});
