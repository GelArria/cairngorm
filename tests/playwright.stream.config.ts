import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/fixtures",
  testMatch: "visual-app.pw.ts",
  outputDir: "../logs/test-results/visual-app",
  reporter: "line",
  workers: 1,
  timeout: 15000,
  use: { baseURL: process.env.CAIRNGORM_FIXTURE_URL, viewport: { width: 1000, height: 680 } },
});
