import type { DetectedShell } from "./types";

export interface LaunchProfile {
  id: string;
  name: string;
  program: string;
  args: string[];
  shell: { path: string; args: string[] } | null;
}
export interface DetectedCli {
  id: string;
  name: string;
  program: string;
  /** Only CLIs added in cairngorm.json carry arguments. */
  args?: string[];
}

export function cleanProfiles(value: unknown): LaunchProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  return value
    .filter((p): p is LaunchProfile => {
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.id !== "string" ||
        !p.id ||
        ids.has(p.id) ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        typeof p.program !== "string" ||
        !p.program.trim() ||
        !Array.isArray(p.args) ||
        !p.args.every((arg: unknown) => typeof arg === "string") ||
        !(
          p.shell === null ||
          (p.shell &&
            typeof p.shell.path === "string" &&
            Array.isArray(p.shell.args) &&
            p.shell.args.every((arg: unknown) => typeof arg === "string"))
        )
      ) {
        return false;
      }
      ids.add(p.id);
      return true;
    })
    .map((p) => ({
      ...p,
      args: [...p.args],
      shell: p.shell ? { path: p.shell.path, args: [...p.shell.args] } : null,
    }));
}

export function shellIdentity(shell: Pick<DetectedShell, "path" | "args">): string {
  const path = /^[a-z]:[\\/]/i.test(shell.path)
    ? shell.path.replace(/\\/g, "/").toLowerCase()
    : shell.path;
  return JSON.stringify([path, shell.args]);
}

export function profileHosts(shells: DetectedShell[]) {
  return shells.filter(
    (s) =>
      /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(s.path) ||
      (navigator.platform.startsWith("Win")
        ? /[\\/]git[\\/].*[\\/]bash\.exe$/i.test(s.path)
        : /(?:^|\/)(?:bash|zsh|sh)$/.test(s.path)),
  );
}
