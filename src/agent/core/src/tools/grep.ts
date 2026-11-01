import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { searchableEntry } from "./workspace-policy.js";

const GrepParams = Type.Object({
  path: Type.String({ description: "Absolute or relative file or directory path" }),
  pattern: Type.String({ description: "Pattern to search for" }),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
});

type GrepParams = Static<typeof GrepParams>;
type GrepDetails = { path: string; matches: number; error?: boolean };

function searchFile(filePath: string, regex: RegExp): string[] {
  if (statSync(filePath).nlink > 1) {
    return [];
  }
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const results: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]!)) {
      results.push(`${i + 1}: ${lines[i]}`);
    }
  }
  return results;
}

function searchDir(dirPath: string, regex: RegExp, cwd: string, results: string[]): void {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !searchableEntry(entry.name)) {
      continue;
    }
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      searchDir(fullPath, regex, cwd, results);
    } else {
      try {
        const lines = searchFile(fullPath, regex);
        if (lines.length > 0) {
          results.push(`--- ${relative(cwd, fullPath)} ---`);
          results.push(...lines);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export const grepTool: AgentTool<typeof GrepParams, GrepDetails> = {
  name: "grep",
  label: "Grep",
  description:
    "Search for a pattern in a file or recursively in a directory. Returns matching lines with line numbers.",
  parameters: GrepParams,
  async execute(
    toolCallId: string,
    params: GrepParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<GrepDetails>,
  ): Promise<AgentToolResult<GrepDetails>> {
    try {
      const flags = params.ignoreCase ? "i" : "";
      const regex = new RegExp(params.pattern, flags);
      const stats = statSync(params.path);
      const cwd = process.cwd();
      const results: string[] = [];

      if (stats.isFile()) {
        results.push(...searchFile(params.path, regex));
      } else {
        searchDir(params.path, regex, cwd, results);
      }

      return {
        content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "(no matches)" }],
        details: { path: params.path, matches: results.length },
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error searching: ${err.message}` }],
        details: { path: params.path, matches: 0, error: true },
      };
    }
  },
};
