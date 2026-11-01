import config from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: "http://localhost:1422" },
  webServer: {
    ...config.webServer,
    command: "npx cross-env E2E_TEST=1 npx vite --port 1422 --strictPort",
    port: 1422,
  },
});
