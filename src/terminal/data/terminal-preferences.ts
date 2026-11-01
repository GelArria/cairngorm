// Terminal behavior only; existing processes keep their shell, new ones use the saved choice.
// Stored in cairngorm.json ("terminal", "shells.default", "launchProfiles").
import { getConfig, subscribeConfig, updateConfig } from "@/config";
import type { DetectedShell } from "../model/types";
import { configuredDefaultShell, subscribeDetectedShells } from "./configured-shells";
import { cleanProfiles, shellIdentity, type LaunchProfile } from "../model/launch-profile";

export interface TerminalPreferences {
  launchProfiles: LaunchProfile[];
  defaultShell: DetectedShell | null;
  clipboard: "windows" | "ctrl-shift";
  scrollback: number;
}
/** Where these lived before cairngorm.json; read once to create the file. */
export const TERMINAL_PREFS_KEY = "terminal-preferences";
export const TERMINAL_DEFAULTS: TerminalPreferences = {
  launchProfiles: [],
  defaultShell: null,
  clipboard: "windows",
  scrollback: 3000,
};
export const SCROLLBACK_RANGE = { min: 100, max: 100000 };

function cleanShell(s: unknown): DetectedShell | null {
  if (!s || typeof s !== "object") {
    return null;
  }
  const v = s as Partial<DetectedShell>;
  if (
    typeof v.name !== "string" ||
    typeof v.path !== "string" ||
    !v.path ||
    !Array.isArray(v.args) ||
    !v.args.every((a) => typeof a === "string")
  ) {
    return null;
  }
  if (
    !v.env ||
    typeof v.env !== "object" ||
    Array.isArray(v.env) ||
    !Object.values(v.env).every((e) => typeof e === "string")
  ) {
    return null;
  }
  return { name: v.name, path: v.path, args: [...v.args], env: { ...v.env }, isDefault: false };
}

function clean(value: Partial<TerminalPreferences>): TerminalPreferences {
  const n = value.scrollback;
  return {
    defaultShell: cleanShell(value.defaultShell),
    launchProfiles: cleanProfiles(value.launchProfiles),
    clipboard: value.clipboard === "ctrl-shift" ? "ctrl-shift" : "windows",
    scrollback:
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(SCROLLBACK_RANGE.min, Math.min(SCROLLBACK_RANGE.max, Math.round(n)))
        : TERMINAL_DEFAULTS.scrollback,
  };
}
function read(): TerminalPreferences {
  const config = getConfig();
  const terminal = (config.terminal ?? {}) as Partial<TerminalPreferences>;
  return clean({
    ...terminal,
    launchProfiles: config.launchProfiles as LaunchProfile[] | undefined,
    defaultShell: configuredDefaultShell(),
  });
}

/** The settings saved before cairngorm.json existed, in its layout (for the first file). */
export function legacyTerminalConfig(): Record<string, unknown> {
  try {
    const old = clean(JSON.parse(localStorage.getItem(TERMINAL_PREFS_KEY) ?? "{}") ?? {});
    const shell = old.defaultShell;
    return {
      ...(shell
        ? {
            shells: {
              default: { name: shell.name, path: shell.path, args: shell.args, env: shell.env },
            },
          }
        : {}),
      terminal: { clipboard: old.clipboard, scrollback: old.scrollback },
      launchProfiles: old.launchProfiles,
    };
  } catch {
    return {};
  }
}
let preferences = read();
const listeners = new Set<(p: TerminalPreferences) => void>();
export const getTerminalPreferences = () => preferences;

export function setTerminalPreferences(patch: Partial<TerminalPreferences>) {
  // Each config write below re-reads `preferences` from the file before the next one lands,
  // so the values to write are taken from this copy.
  const next = clean({ ...preferences, ...patch });
  preferences = next;
  listeners.forEach((fn) => fn(preferences));
  const writes: Promise<void>[] = [];
  if ("defaultShell" in patch) {
    const shell = next.defaultShell;
    writes.push(
      updateConfig(
        ["shells", "default"],
        shell
          ? { name: shell.name, path: shell.path, args: shell.args, env: shell.env }
          : undefined,
      ),
    );
  }
  if ("launchProfiles" in patch) {
    writes.push(updateConfig(["launchProfiles"], next.launchProfiles));
  }
  for (const key of ["clipboard", "scrollback"] as const) {
    if (key in patch) {
      writes.push(updateConfig(["terminal", key], next[key]));
    }
  }
  void Promise.all(writes).catch((error) => console.error("[settings] cairngorm.json", error));
}

export function subscribeTerminalPreferences(fn: (p: TerminalPreferences) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
// Every window follows the file (edited here, in another window or by hand) without
// recreating its PTYs; a default shell given by name resolves once shells are detected.
const refresh = () => {
  preferences = read();
  listeners.forEach((fn) => fn(preferences));
};
subscribeConfig(refresh);
subscribeDetectedShells(refresh);

export function isDefaultShell(shell: DetectedShell, p = preferences): boolean {
  return p.defaultShell ? shellIdentity(shell) === shellIdentity(p.defaultShell) : shell.isDefault;
}
