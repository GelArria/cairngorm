import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import nativePluginCheck from "./tests/e2e/native-plugin.config";

const mocked = {
  tests: "tests/e2e/**/*.e2e.ts",
  output: "logs/e2e/reader",
  workers: 1,
  cache: "off",
  targets: [
    {
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "node",
          args: [
            "node_modules/vite/bin/vite.js",
            "--host",
            "127.0.0.1",
            "--port",
            "{port}",
            "--strictPort",
          ],
          env: { E2E_TEST: "1" },
          log: "logs/e2e/reader/vite.log",
        },
      },
    },
  ],
} satisfies E2EConfig;

export default process.env.CAIRNGORM_NATIVE_PLUGIN_CHECK === "1" ? nativePluginCheck : mocked;
