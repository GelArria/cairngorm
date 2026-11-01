import { runCliSidecar, type CliEngine } from "./cli-sidecar.js";

/** Gemini CLI's session ids are UUIDs; anything else is never passed back to `--resume`. */
const SESSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function geminiFailure(reason: string) {
  if (/quota|exhausted|usage limit|rate limit|429/i.test(reason)) {
    return "Gemini usage limit reached. Wait for your quota to reset or check your Google AI plan.";
  }
  if (/trust/i.test(reason)) {
    return "Gemini CLI does not trust this folder. Run gemini in it once and trust it, then retry.";
  }
  return "Gemini CLI could not complete the request. Check your CLI login and quota in AI providers.";
}

export const geminiEngine: CliEngine = {
  name: "Gemini CLI",
  commandEnv: "CAIRNGORM_GEMINI_COMMAND",
  model: "Gemini CLI · Google AI subscription",
  profile: "workspace edits · shell, web and MCP off",
  // The prompt arrives on stdin; piped stdio runs Gemini CLI headless.
  args: (session) => ["--output-format", "stream-json", ...(session ? ["--resume", session] : [])],
  // Hooks still run when the machine has its own Gemini CLI system settings: without this,
  // Cairngorm's session hook would report the agent tab as a Gemini CLI session to restore.
  env: (base) => {
    const env = { ...base };
    delete env.CAIRNGORM_SESSION_REPORT;
    return env;
  },
  exitFailure: (stderr) =>
    /trust|quota|exhausted|usage limit|rate limit/i.test(stderr)
      ? geminiFailure(stderr)
      : undefined,
  reader: (turn) => {
    let text = "";
    // Gemini CLI follows a specific error event with a generic failed result: keep the first.
    let failed = false;
    const flush = () => {
      if (text.trim()) {
        turn.reply(text);
      }
      text = "";
    };
    return {
      read(event) {
        if (event.type === "init" && SESSION.test(String(event.session_id ?? ""))) {
          turn.setSession(event.session_id);
        } else if (
          event.type === "message" &&
          event.role === "assistant" &&
          typeof event.content === "string"
        ) {
          text += event.content;
        } else if (event.type === "tool_use") {
          // Text written before a tool call is its own reply, as with Codex.
          flush();
          turn.toolStart(
            String(event.tool_id),
            String(event.tool_name ?? "tool"),
            JSON.stringify(event.parameters ?? {}),
          );
        } else if (event.type === "tool_result") {
          turn.toolEnd(
            String(event.tool_id),
            String(event.output ?? event.error?.message ?? ""),
            event.status === "error",
          );
        } else if (
          (event.type === "error" && event.severity === "error") ||
          (event.type === "result" && event.status === "error")
        ) {
          if (!failed) {
            failed = true;
            turn.fail(geminiFailure(String(event.message ?? event.error?.message ?? "")));
          }
        }
      },
      finish: flush,
    };
  },
};

export function runGeminiSidecar(sessionId: string, input: NodeJS.ReadableStream = process.stdin) {
  return runCliSidecar(geminiEngine, sessionId, input);
}
