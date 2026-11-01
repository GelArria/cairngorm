// Managed by Cairngorm. Inert outside its PTYs; never reads conversation contents.
import { renameSync, writeFileSync } from "node:fs";

// Restrictive launch flags restored with the session (true = takes a value). Model and thinking
// level are already restored from the session file; Cairngorm validates these again.
const LAUNCH_FLAGS: Record<string, boolean> = {
  "--tools": true,
  "-t": true,
  "--exclude-tools": true,
  "-xt": true,
  "--no-tools": false,
  "-nt": false,
  "--no-builtin-tools": false,
  "-nbt": false,
  "--no-mcp": false,
  "--plan": false,
};

function launchFlags(args: string[]): string[] {
  const flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      break;
    }
    const name = arg.split("=", 1)[0];
    if (!(name in LAUNCH_FLAGS)) {
      continue;
    }
    flags.push(arg);
    if (LAUNCH_FLAGS[name] && !arg.includes("=") && i + 1 < args.length) {
      flags.push(args[++i]);
    }
  }
  return flags;
}

export default function (pi: any) {
  const flags = launchFlags(process.argv.slice(2));
  const report = (_event: unknown, ctx: any) => {
    const file = process.env.CAIRNGORM_SESSION_REPORT;
    if (!file || ctx.mode !== "tui") {
      return;
    } // headless/subagent sessions do not own the pane
    const id = ctx.sessionManager.getSessionId();
    const path = ctx.sessionManager.getSessionFile();
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ agent: "pi", id, path, cwd: ctx.cwd, flags }));
      renameSync(tmp, file);
    } catch {
      /* reporting must never interrupt the agent */
    }
  };
  pi.on("session_start", report); // includes /new, /resume, /fork and reload
  pi.on("agent_start", report);
  pi.on("agent_end", report);
}
