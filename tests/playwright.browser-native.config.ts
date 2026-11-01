import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["browser-preview-native.spec.ts", "visual-testing-native.spec.ts"],
  outputDir: "../logs/e2e/browser-native-results",
  metadata: { nativeVisualTesting: true, nativeBrowserPreview: true },
  workers: 1,
  timeout: 60000,
  use: { trace: "retain-on-failure" },
});
