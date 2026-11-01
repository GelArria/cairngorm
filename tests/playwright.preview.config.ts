import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Same suite as playwright.config.ts, against an already-running mocked Vite on
// :1430 (E2E_TEST=1) — usable while the real dev server holds :1420.
export default defineConfig({
  ...config,
  webServer: undefined,
  use: { baseURL: "http://localhost:1430", trace: "on-first-retry" },
});
