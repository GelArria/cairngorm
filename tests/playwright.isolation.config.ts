import { defineConfig } from "@playwright/test";

// The Rust fixture supplies scoped origins and CSP; this spec starts its own server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "plugin-isolation.spec.ts",
  outputDir: "../logs/test-results/plugin-isolation",
  timeout: 30000,
  retries: 0,
});
