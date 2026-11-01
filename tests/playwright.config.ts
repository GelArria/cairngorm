import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 1421);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Native/CDP suites must never attach to a user's app from a mocked run,
  // even when an opt-in environment variable is inherited by this terminal.
  testIgnore: [
    "**/*-native*.spec.ts",
    "**/agent-interaction.spec.ts",
    "**/cli-agent-battery.spec.ts",
    "**/plugin-isolation.spec.ts",
    "**/terminal.spec.ts",
    "**/terminal-edge-cases.spec.ts",
    "**/terminal-input-parity.spec.ts",
    "**/terminal-split-flows.spec.ts",
  ],
  outputDir: path.join(here, "..", "logs", "test-results"),
  // A cold Vite module graph takes over 30 seconds on Windows before the first DOM loads.
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    // Keep the mocked server separate from native Tauri's real Vite on 1420.
    command: `npx cross-env E2E_TEST=1 npx vite --port ${port} --strictPort`,
    port,
    // default cwd = config dir (tests/) → vite 404 on "/"; explicit repo root.
    cwd: path.join(here, ".."),
    reuseExistingServer: false,
  },
});
