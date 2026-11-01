import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  shells: [] as {
    name: string;
    path: string;
    args: string[];
    env: Record<string, string>;
    isDefault: boolean;
  }[],
  preferred: null as null | {
    name: string;
    path: string;
    args: string[];
    env: Record<string, string>;
    isDefault: boolean;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/terminal/data/configured-shells", () => ({ configuredShells: () => state.shells }));
vi.mock("@/terminal/data/terminal-preferences", () => ({
  getTerminalPreferences: () => ({ defaultShell: state.preferred }),
}));
import { catalogProfile } from "@/terminal/data/cli-launch";

const shell = (name: string, path: string, args: string[] = [], isDefault = false) => ({
  name,
  path,
  args,
  env: {},
  isDefault,
});
const powershell = shell(
  "PowerShell",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  [],
  true,
);
const gitBash = shell("Git Bash", "C:\\Program Files\\Git\\bin\\bash.exe", ["--login", "-i"]);
const cmd = shell("Command Prompt", "C:\\Windows\\System32\\cmd.exe");
const claude = { id: "claude", name: "Claude Code", program: "claude" };

beforeEach(() => {
  vi.stubGlobal("navigator", { platform: "Win32" });
  state.shells = [powershell, cmd, gitBash];
  state.preferred = null;
});

describe("catalog CLIs run inside a shell that stays after they exit", () => {
  it("uses the default shell when it can host the CLI", () => {
    state.preferred = gitBash;
    expect(catalogProfile(claude).shell).toEqual({ path: gitBash.path, args: ["--login", "-i"] });
  });
  it("falls back to the platform default when the chosen shell cannot host it", () => {
    state.preferred = cmd;
    expect(catalogProfile(claude).shell?.path).toBe(powershell.path);
  });
  it("runs the CLI on its own when no shell can host it", () => {
    state.shells = [cmd];
    expect(catalogProfile(claude).shell).toBeNull();
  });
});
