import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { readFileSync } from "node:fs";

const ReadParams = Type.Object({
  path: Type.String({ description: "Absolute or relative file path" }),
});

type ReadParams = Static<typeof ReadParams>;
type ReadDetails = { path: string; size: number; error?: boolean };

export const fileReadTool: AgentTool<typeof ReadParams, ReadDetails> = {
  name: "file-read",
  label: "Read File",
  description: "Read the contents of a file. Returns the file text.",
  parameters: ReadParams,
  async execute(
    toolCallId: string,
    params: ReadParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<ReadDetails>,
  ): Promise<AgentToolResult<ReadDetails>> {
    try {
      const content = readFileSync(params.path, "utf-8");
      const truncated =
        content.length > 50000 ? content.slice(0, 50000) + "\n... (truncated)" : content;
      return {
        content: [{ type: "text", text: truncated }],
        details: { path: params.path, size: content.length },
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error reading file: ${err.message}` }],
        details: { path: params.path, size: 0, error: true },
      };
    }
  },
};
