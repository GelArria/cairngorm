import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "../agent/types.js";
import { Type, type Static } from "typebox";
import { shellStream } from "./shell-stream.js";

const shellName = process.platform === "win32" ? "Windows cmd.exe" : "bash";

const BashParams = Type.Object({
  command: Type.String({ description: `The ${shellName} command to execute` }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default 30000)" })),
});

type BashParams = Static<typeof BashParams>;
type BashDetails = { command: string; exitCode: number };

export const bashTool: AgentTool<typeof BashParams, BashDetails> = {
  name: "bash",
  label: "Bash",
  description: `Execute a ${shellName} command. Returns stdout, stderr, and exit code.`,
  parameters: BashParams,
  async execute(
    _toolCallId: string,
    params: BashParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<BashDetails>,
  ): Promise<AgentToolResult<BashDetails>> {
    const timeout = params.timeout ?? 30000;
    const result = await shellStream(params.command, timeout, signal, (output) =>
      onUpdate?.({
        content: [{ type: "text", text: output }],
        details: { command: params.command, exitCode: 0 },
      }),
    );
    return {
      content: [{ type: "text", text: result.output }],
      details: { command: params.command, exitCode: result.exitCode },
    };
  },
};
