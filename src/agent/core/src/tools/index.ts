import type { AgentTool } from "../agent/types.js";
import { bashTool } from "./bash.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { grepTool } from "./grep.js";
import { globTool } from "./glob.js";
import { editTool } from "./edit.js";

export function allTools(): AgentTool<any>[] {
  return [bashTool, fileReadTool, fileWriteTool, grepTool, globTool, editTool] as AgentTool<any>[];
}
