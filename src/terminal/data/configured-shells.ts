// Shells from detection plus cairngorm.json ("shells": { "hide", "add", "default" }).
import { getConfig } from "@/config";
import type { DetectedShell } from "../model/types";

let detected: DetectedShell[] = [];
const listeners = new Set<() => void>();

function section(): Record<string, unknown> {
  const shells = getConfig().shells;
  return shells && typeof shells === "object" && !Array.isArray(shells)
    ? (shells as Record<string, unknown>)
    : {};
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A shell written in cairngorm.json, or null when it is not complete. */
export function configuredShell(value: unknown): DetectedShell | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const shell = value as Record<string, unknown>;
  if (typeof shell.name !== "string" || typeof shell.path !== "string" || !shell.path.trim()) {
    return null;
  }
  const env =
    shell.env && typeof shell.env === "object" && !Array.isArray(shell.env)
      ? Object.fromEntries(
          Object.entries(shell.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return { name: shell.name, path: shell.path, args: strings(shell.args), env, isDefault: false };
}

/** Detected shells minus `hide`, plus `add`. */
export function withConfiguredShells(shells: DetectedShell[]): DetectedShell[] {
  const config = section();
  const hidden = new Set(strings(config.hide).map((name) => name.toLowerCase()));
  const added = (Array.isArray(config.add) ? config.add : [])
    .map(configuredShell)
    .filter((shell): shell is DetectedShell => !!shell);
  return [...shells.filter((s) => !hidden.has(s.name.toLowerCase())), ...added];
}

/** `"default"`: a shell object, or the name of a detected/added shell. */
export function configuredDefaultShell(): DetectedShell | null {
  const value = section().default;
  if (typeof value === "string") {
    const name = value.toLowerCase();
    return withConfiguredShells(detected).find((s) => s.name.toLowerCase() === name) ?? null;
  }
  return configuredShell(value);
}

/** Detected shells with cairngorm.json applied, as last detected. */
export function configuredShells(): DetectedShell[] {
  return withConfiguredShells(detected);
}

/** Detection results, so a default given by name resolves once shells are known. */
export function setDetectedShells(shells: DetectedShell[]) {
  detected = shells;
  listeners.forEach((listener) => listener());
}

export function subscribeDetectedShells(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
