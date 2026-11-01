import { defineConfig } from "@playwright/test";
import cdp from "./playwright.cdp.config";

export default defineConfig({
  ...cdp,
  testMatch: ["terminal-images-native.spec.ts"],
  metadata: { nativeImages: true },
  timeout: 60000,
  workers: 1,
});
