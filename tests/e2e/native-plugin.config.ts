import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

// Explicit opt-in: attach only to the isolated native sandbox, never a user's app.
export default {
  tests: "tests/e2e/native-plugin-reload.live.ts",
  output: "logs/e2e/native-plugin",
  workers: 1,
  cache: "off",
  targets: [
    {
      engine: web({
        viewport: null,
        connect: {
          cdpEndpoint: () => "http://127.0.0.1:9222",
          reconnectEndpoint: () => "http://127.0.0.1:9222",
        },
      }),
      app: { url: "http://localhost:1420" },
    },
  ],
} satisfies E2EConfig;
