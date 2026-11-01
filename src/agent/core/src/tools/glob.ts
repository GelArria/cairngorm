import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { searchableEntry } from "./workspace-policy.js";

const GlobParams = Type.Object({
  pattern: Type.String({ description: "Glob pattern with * and ** wildcards" }),
  cwd: Type.Optional(Type.String({ description: 'Working directory (default ".")' })),
});

type GlobParams = Static<typeof GlobParams>;
type GlobDetails = { pattern: string; cwd: string; matches: number };

function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      regex += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      regex += "[^/\\\\]*";
      i++;
    } else if (pattern[i] === "?") {
      regex += ".";
      i++;
    } else {
      regex += pattern[i]!.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

function listFiles(dir: string, base: string, files: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !searchableEntry(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      listFiles(fullPath, base, files);
    } else {
      files.push(relPath);
    }
  }
}

export const globTool: AgentTool<typeof GlobParams, GlobDetails> = {
  name: "glob",
  label: "Glob",
  description: "List files recursively matching a glob pattern (* and ** supported).",
  parameters: GlobParams,
  async execute(
    toolCallId: string,
    params: GlobParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<GlobDetails>,
  ): Promise<AgentToolResult<GlobDetails>> {
    const cwd = params.cwd || ".";
    const regex = globToRegex(params.pattern.replace(/\\/g, "/"));
    const allFiles: string[] = [];
    listFiles(cwd, cwd, allFiles);
    const matches = allFiles.filter((f) => regex.test(f));
    return {
      content: [{ type: "text", text: matches.join("\n") || "(no matches)" }],
      details: { pattern: params.pattern, cwd, matches: matches.length },
    };
  },
};
