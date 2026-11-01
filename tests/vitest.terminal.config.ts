import { defineConfig } from "vitest/config";
import appConfig from "../vite.config";

// Run internal hook tests explicitly without broadening the root unit suite.
export default defineConfig(async (env) => {
  const config = await appConfig(env);
  return {
    ...config,
    test: { ...config.test, include: ["src/terminal/hooks/__tests__/**/*.test.ts"] },
  };
});
