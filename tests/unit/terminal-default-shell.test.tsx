import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/preact";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/data/scrollback-store", () => ({ clearScrollback: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("applies the default only to new unspecified shells, not explicit shells or the native agent", async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const prefs = await import("../../src/terminal/data/terminal-preferences");
  const shell = {
    name: "Bash",
    path: "/bin/bash",
    args: ["-l"],
    env: { TERM: "xterm-256color" },
    isDefault: false,
  };
  prefs.setTerminalPreferences({ defaultShell: shell });
  const mod = await import("../../src/terminal/hooks/use-terminal-tabs");
  const { result } = renderHook(() => mod.useTerminalTabs());
  act(() => result.current.openTab());
  expect(result.current.activeTab).toMatchObject({
    shellPath: shell.path,
    shellArgs: shell.args,
    shellEnv: shell.env,
  });
  const first = result.current.activeTab!;
  act(() =>
    result.current.openTab({
      profile: "code-assistant",
      shellPath: "pwsh.exe",
      shellArgs: ["-NoProfile"],
    }),
  );
  expect(result.current.activeTab?.shellPath).toBe("pwsh.exe");
  act(() =>
    result.current.openTab({
      profile: "code-assistant",
      shellPath: "cairngorm-agent.exe",
      shellArgs: ["--sidecar"],
      isAgent: true,
    }),
  );
  expect(result.current.activeTab?.shellPath).toBe("cairngorm-agent.exe");
  act(() => result.current.restartTab(first.id));
  expect(result.current.activeTab?.sessionId).not.toBe(first.sessionId);
}, 15000);

it("never reuses a backend session when pane counters reset on frontend reload", async () => {
  vi.resetModules();
  const firstModule = await import("../../src/terminal/hooks/use-terminal-tabs");
  const firstHook = renderHook(() => firstModule.useTerminalTabs());
  act(() => firstHook.result.current.openTab());
  const first = firstHook.result.current.activeTab!;
  firstHook.unmount();
  vi.resetModules();
  const secondModule = await import("../../src/terminal/hooks/use-terminal-tabs");
  const secondHook = renderHook(() => secondModule.useTerminalTabs());
  act(() => secondHook.result.current.openTab());
  expect(secondHook.result.current.activeTab?.id).toBe(first.id);
  expect(secondHook.result.current.activeTab?.sessionId).not.toBe(first.sessionId);
});
