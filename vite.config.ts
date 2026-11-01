/// <reference types="vitest" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "path";

const e2e = process.env.E2E_TEST === "1";

export default defineConfig(async () => ({
  plugins: [preact()],
  // shortcut: esbuild 0.21 corrupts xterm locals; re-enable after an upgrade passes the production test.
  esbuild: { minifySyntax: false },
  // The mocked E2E server keeps its own dep cache — sharing node_modules/.vite
  // with the regular dev server makes them overwrite each other's prebundles.
  cacheDir: e2e ? "node_modules/.vite-e2e" : "node_modules/.vite",
  // Pre-bundle every CodeMirror package together. The language packs are
  // dynamic imports in code-editor.tsx; discovered at runtime, Vite re-optimizes
  // and serves a second @codemirror/state → "Unrecognized extension value…
  // multiple instances of @codemirror/state" and the editor never mounts.
  optimizeDeps: {
    // Generated reports and Cargo HTML assets are not application entry points.
    entries: ["index.html"],
    include: [
      "codemirror",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/search",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "@codemirror/lang-javascript",
      "@codemirror/lang-markdown",
      "@codemirror/lang-python",
      "@codemirror/lang-rust",
      "@codemirror/lang-css",
      "@codemirror/lang-html",
      "@codemirror/lang-json",
      "@codemirror/lang-yaml",
      "@lezer/highlight",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...(e2e
        ? {
            "@tauri-apps/api/core": path.resolve(__dirname, "./tests/mocks/tauri-core.ts"),
            "@tauri-apps/api/path": path.resolve(__dirname, "./tests/mocks/tauri-path.ts"),
            "@tauri-apps/api/event": path.resolve(__dirname, "./tests/mocks/tauri-event.ts"),
            "@tauri-apps/plugin-dialog": path.resolve(__dirname, "./tests/mocks/tauri-dialog.ts"),
            "@tauri-apps/plugin-shell": path.resolve(__dirname, "./tests/mocks/tauri-shell.ts"),
            // The gateway serves the SDK beside each provider; Vite resolves the same import.
            "./_cairngorm/document-sdk.js": path.resolve(
              __dirname,
              "./src/documents/sdk/generated/document-sdk.js",
            ),
          }
        : {}),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            "codemirror",
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
          ],
          xterm: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-web-links",
            "@xterm/addon-unicode11",
          ],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/src/**/native/**", "**/src/agent/core/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", "logs/**"],
  },
}));
