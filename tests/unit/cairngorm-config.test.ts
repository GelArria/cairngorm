// cairngorm.json: edits keep the user's comments, detection is adjusted by hide/add, and the
// first file is created from the settings this machine already had.
import { beforeEach, expect, it, vi } from "vitest";
import jsoncCases from "../fixtures/config-jsonc.json";

const files = vi.hoisted(() => ({ text: null as string | null, writes: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { text?: string }) => {
    if (command === "config_read") return { path: "C:/data/cairngorm.json", text: files.text };
    if (command === "config_write") {
      files.text = args.text!;
      files.writes.push(args.text!);
      return null;
    }
    if (command === "detect_agent_clis") {
      return [
        { id: "claude", name: "Claude Code", program: "claude" },
        { id: "amp", name: "Amp", program: "amp" },
      ];
    }
    throw new Error(`unexpected ${command}`);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

beforeEach(() => {
  vi.resetModules();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  files.text = null;
  files.writes = [];
});

it.each(jsoncCases)("shares the native JSONC contract: $name", async ({ source, expected }) => {
  const { parseConfig } = await import("@/config/data/config-store");
  expect(await parseConfig(source)).toEqual(expected);
});

it("creates the file from older settings and keeps comments when a value changes", async () => {
  const config = await import("@/config");
  await config.loadConfig(() => ({ terminal: { scrollback: 5000 } }));
  expect(files.text).toContain('"scrollback": 5000');
  expect(files.text).toContain("// Cairngorm settings");
  files.text = files.text!.replace('"terminal"', '// my own note\n  "terminal"');
  await config.loadConfig();
  await config.updateConfig(["terminal", "clipboard"], "ctrl-shift");
  expect(files.text).toContain("// my own note");
  expect(files.text).toContain('"clipboard": "ctrl-shift"');
  expect(config.getConfig()).toMatchObject({
    terminal: { scrollback: 5000, clipboard: "ctrl-shift" },
  });
  await config.updateConfig(["terminal", "missing"], undefined);
  expect(config.getConfigError()).toBe("");
});

it("keeps the last valid settings when the file has a syntax error", async () => {
  files.text = '{ "terminal": { "scrollback": 4000 } }';
  const config = await import("@/config");
  await config.loadConfig();
  files.text = '{ "terminal": ';
  await config.loadConfig();
  expect(config.getConfig()).toMatchObject({ terminal: { scrollback: 4000 } });
  expect(config.getConfigError()).toContain("syntax error");
});

it("hides and adds shells, and resolves the default shell by name", async () => {
  files.text = JSON.stringify({
    shells: {
      hide: ["Command Prompt"],
      add: [{ name: "Node REPL", path: "node", args: ["-i"] }],
      default: "Node REPL",
    },
  });
  const config = await import("@/config");
  await config.loadConfig();
  const shells = await import("@/terminal/data/configured-shells");
  const detected = [
    { name: "PowerShell", path: "pwsh.exe", args: [], env: {}, isDefault: true },
    { name: "Command Prompt", path: "cmd.exe", args: [], env: {}, isDefault: false },
  ];
  shells.setDetectedShells(detected);
  expect(shells.withConfiguredShells(detected).map((s) => s.name)).toEqual([
    "PowerShell",
    "Node REPL",
  ]);
  expect(shells.configuredDefaultShell()).toMatchObject({ path: "node", args: ["-i"] });
});

it("hides detected agent CLIs and adds custom ones with arguments", async () => {
  files.text = JSON.stringify({
    agentClis: { hide: ["amp"], add: [{ name: "My agent", program: "my-agent", args: ["--tui"] }] },
  });
  const config = await import("@/config");
  await config.loadConfig();
  const clis = await import("@/terminal/data/cli-launch");
  await clis.scanClis(true);
  const list = clis.getClis();
  expect(list.map((c) => c.name)).toEqual(["Claude Code", "My agent"]);
  expect(clis.cliProfile(list[1])).toMatchObject({
    program: "my-agent",
    args: ["--tui"],
    shell: null,
  });
});

it("applies a change to the file as it is on disk, keeping another window's change", async () => {
  files.text = '{ "terminal": { "scrollback": 4000 } }';
  const config = await import("@/config");
  await config.loadConfig();
  // Another window (or an editor) saved meanwhile; this window has not reloaded yet.
  files.text =
    '{ "terminal": { "scrollback": 4000 }, "documents": { "openWith": { "csv": "x" } } }';
  await config.updateConfig(["terminal", "clipboard"], "ctrl-shift");
  expect(files.text).toContain('"csv": "x"');
  expect(files.text).toContain('"clipboard": "ctrl-shift"');
});

it("does not save over a file with a syntax error", async () => {
  files.text = '{ "terminal": ';
  const config = await import("@/config");
  await config.loadConfig();
  await expect(config.updateConfig(["terminal", "clipboard"], "ctrl-shift")).rejects.toThrow(
    "syntax error",
  );
  expect(files.text).toBe('{ "terminal": ');
  expect(config.getConfig()).not.toMatchObject({ terminal: { clipboard: "ctrl-shift" } });
});

it("only the window allowed to create the file creates it", async () => {
  const config = await import("@/config");
  await config.loadConfig();
  expect(files.text).toBeNull();
  await config.loadConfig(() => ({}));
  expect(files.text).toContain("$schema");
});
