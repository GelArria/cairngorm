// @vitest-environment node
import { resolve } from "node:path";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { build } from "vite";
import { expect, it, vi } from "vitest";

it("preserves terminal mode queries and resizing in the production bundle", async () => {
  const result = await build({
    configFile: resolve("vite.config.ts"),
    logLevel: "silent",
    build: {
      write: false,
      lib: {
        entry: resolve("node_modules/@xterm/xterm/lib/xterm.mjs"),
        formats: ["es"],
      },
      rollupOptions: { output: { manualChunks: undefined } },
    },
  });
  if (!Array.isArray(result)) {
    throw new Error("Expected a production library build");
  }
  const entry = result[0].output.find((item) => item.type === "chunk" && item.isEntry);
  if (!entry || entry.type !== "chunk") {
    throw new Error("Missing the production terminal entry");
  }
  const url = `data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`;
  const { Terminal }: { Terminal: typeof XtermTerminal } = await import(/* @vite-ignore */ url);

  vi.useFakeTimers();
  const term = new Terminal();
  const replies: string[] = [];
  term.onData((data) => replies.push(data));
  try {
    const parsed = vi.fn();
    term.write("\x1b[?2026$p\x1b[?2004$p\x1b[4$pready", parsed);
    await vi.runAllTimersAsync();
    expect(parsed).toHaveBeenCalledOnce();
    expect(replies).toEqual(["\x1b[?2026;2$y", "\x1b[?2004;2$y", "\x1b[4;2$y"]);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("ready");
    term.resize(120, 40);
    expect([term.cols, term.rows]).toEqual([120, 40]);
  } finally {
    term.dispose();
    vi.useRealTimers();
  }
  // A real production build: slower than 5 s while the full suite runs in parallel.
}, 60_000);
