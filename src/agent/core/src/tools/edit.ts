import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { readFileSync, writeFileSync } from "node:fs";

const EditParams = Type.Object({
  path: Type.String({ description: "Absolute or relative file path" }),
  old_string: Type.String({ description: "String to replace" }),
  new_string: Type.String({ description: "Replacement string" }),
});

type EditParams = Static<typeof EditParams>;
type EditDetails = { path: string; replaced: boolean };

export const editTool: AgentTool<typeof EditParams, EditDetails> = {
  name: "edit",
  label: "Edit",
  description: "Replace the first occurrence of old_string with new_string in a file.",
  parameters: EditParams,
  async execute(
    toolCallId: string,
    params: EditParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<EditDetails>,
  ): Promise<AgentToolResult<EditDetails>> {
    const content = readFileSync(params.path, "utf-8");
    const idx = content.indexOf(params.old_string);
    if (idx === -1) {
      throw new Error(`old_string not found in ${params.path}`);
    }
    const newContent =
      content.slice(0, idx) + params.new_string + content.slice(idx + params.old_string.length);
    writeFileSync(params.path, newContent, "utf-8");
    return {
      content: [{ type: "text", text: `Edited ${params.path}` }],
      details: { path: params.path, replaced: true },
    };
  },
};
