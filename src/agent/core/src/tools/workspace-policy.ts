import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, parse, relative, resolve, sep } from "node:path";
import type { AgentTool } from "../agent/types.js";
import { allTools } from "./index.js";

const PROTECTED =
  /^(?:\.git|\.ssh|\.aws|\.azure|\.codex|\.claude|\.panel|\.gnupg|\.npmrc|\.netrc|\.env(?:\..*)?|id_rsa|id_ed25519)$/i;

/** Application-level containment; an OS sandbox is still needed against local races. */
export function workspacePath(root: string, input: string): string {
  if (
    input.includes("\0") ||
    (process.platform === "win32" && /[:]/.test(relative(root, resolve(root, input))))
  ) {
    throw new Error("Invalid workspace path");
  }
  const target = resolve(root, input);
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Agent file access is limited to the project folder");
  }
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    if (process.platform === "win32" && (/[ .]$/.test(part) || /[<>:"|?*]/.test(part))) {
      throw new Error("Invalid workspace path");
    }
    if (PROTECTED.test(part)) {
      throw new Error("Agent access to credential files and repository metadata is disabled");
    }
    current = resolve(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (
      stat.isSymbolicLink() ||
      (stat.isFile() && stat.nlink > 1) ||
      (!stat.isDirectory() && !stat.isFile())
    ) {
      throw new Error("Agent access to links and special files is disabled");
    }
    if (PROTECTED.test(basename(realpathSync(current)))) {
      throw new Error("Agent access to credential files and repository metadata is disabled");
    }
  }
  return target;
}

export function workspaceTools(directory: string, allowShell = false): AgentTool<any>[] {
  const root = realpathSync(directory);
  if (
    root === parse(root).root ||
    root === realpathSync(homedir()) ||
    PROTECTED.test(basename(root))
  ) {
    throw new Error(
      "Start the Cairngorm agent inside a project folder, away from your home or disk root",
    );
  }
  return allTools()
    .filter((tool) => allowShell || tool.name !== "bash")
    .map((tool) => ({
      ...tool,
      execute: (id, args, signal, update) => {
        if (!args || typeof args !== "object") {
          throw new Error("Invalid tool arguments");
        }
        const params: Record<string, unknown> = { ...args };
        if (tool.name === "glob") {
          params.cwd = workspacePath(root, String(params.cwd ?? "."));
        } else if (tool.name !== "bash") {
          params.path = workspacePath(root, String(params.path ?? "."));
        }
        return tool.execute(id, params, signal, update);
      },
    }));
}

export function searchableEntry(name: string): boolean {
  return !PROTECTED.test(name) && name !== "node_modules";
}
