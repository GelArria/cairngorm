import { spawn } from "node:child_process";
import { shellEnvironment } from "./shell-environment.js";

export interface ShellResult {
  output: string;
  exitCode: number;
}

/** Streaming replacement for execSync; cancellation kills the command's child tree. */
export function shellStream(
  command: string,
  timeout: number,
  signal?: AbortSignal,
  update?: (output: string) => void,
): Promise<ShellResult> {
  if (signal?.aborted) {
    return Promise.resolve({ output: "Command aborted", exitCode: 130 });
  }
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    const child = spawn(command, {
      shell: windows ? process.env.ComSpec || "cmd.exe" : "/bin/bash",
      windowsHide: true,
      detached: !windows,
      env: shellEnvironment(),
    });
    let output = "";
    let bytes = 0;
    let stopped = false;
    let termination: { message: string; code: number } | undefined;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      clearTimeout(updateTimer);
      updateTimer = undefined;
      update?.(output);
    };
    const terminate = (message: string, code: number) => {
      if (stopped || termination) {
        return;
      }
      termination = { message, code };
      if (windows && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* already exited */
          }
        }, 200);
      } else {
        child.kill();
      }
    };
    const abort = () => terminate("Command aborted", 130);
    const timer = setTimeout(() => terminate(`Command timed out after ${timeout}ms`, 124), timeout);
    const finish = (code: number, message?: string) => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(updateTimer);
      signal?.removeEventListener("abort", abort);
      const suffix = termination?.message ?? message;
      if (suffix) {
        output += `\n${suffix}`;
      }
      publish();
      resolve({ output: output || "(no output)", exitCode: termination?.code ?? code });
    };
    const data = (text: string) => {
      if (stopped || termination) {
        return;
      }
      bytes += Buffer.byteLength(text);
      if (bytes > 1024 * 1024) {
        terminate("Command output exceeded 1 MiB", 1);
        return;
      }
      output += text;
      if (!updateTimer) {
        updateTimer = setTimeout(publish, 60);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", data);
    child.stderr.on("data", data);
    child.on("error", (error) => finish(1, error.message));
    child.on("close", (code, exitSignal) => finish(code ?? (exitSignal ? 130 : 1)));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}
