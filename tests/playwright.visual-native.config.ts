import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "visual-testing-native.spec.ts",
  outputDir: "../logs/e2e/visual-native-results",
  metadata: { nativeVisualTesting: true },
  workers: 1,
  timeout: 45000,
  use: { trace: "retain-on-failure" },
});
