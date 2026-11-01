import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const WriteParams = Type.Object({
  path: Type.String({ description: "Absolute or relative file path" }),
  content: Type.String({ description: "Content to write" }),
});

type WriteParams = Static<typeof WriteParams>;
type WriteDetails = { path: string; size: number; error?: boolean };

export const fileWriteTool: AgentTool<typeof WriteParams, WriteDetails> = {
  name: "file-write",
  label: "Write File",
  description: "Write content to a file. Creates parent directories if needed.",
  parameters: WriteParams,
  async execute(
    toolCallId: string,
    params: WriteParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<WriteDetails>,
  ): Promise<AgentToolResult<WriteDetails>> {
    try {
      mkdirSync(dirname(params.path), { recursive: true });
      writeFileSync(params.path, params.content, "utf-8");
      return {
        content: [{ type: "text", text: `Wrote ${params.content.length} chars to ${params.path}` }],
        details: { path: params.path, size: params.content.length },
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error writing file: ${err.message}` }],
        details: { path: params.path, size: 0, error: true },
      };
    }
  },
};
