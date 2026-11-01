import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

if (!process.env.CAIRNGORM_FRESH_HOME || !process.env.CAIRNGORM_FRESH_CDP) {
  throw new Error("Use the fresh-profile harness, never the installed app.");
}
export default {
  tests: "tests/e2e/native-fresh.live.ts",
  output: "logs/e2e/native-fresh",
  workers: 1,
  cache: "off",
  targets: [
    {
      engine: web({
        viewport: null,
        connect: {
          cdpEndpoint: () => process.env.CAIRNGORM_FRESH_CDP!,
          reconnectEndpoint: () => process.env.CAIRNGORM_FRESH_CDP!,
        },
      }),
      app: { url: "http://tauri.localhost/" },
    },
  ],
} satisfies E2EConfig;
