// What a pane prints when its shell can't run: what happened, in plain words,
// and the way out (↻ in the tab, or another shell from +). Raw errors stay as a
// dim second line for whoever needs them.
const RED = "\x1b[31m",
  DIM = "\x1b[2m",
  RESET = "\x1b[0m";

const shellName = (file: string) =>
  (file.replace(/\\/g, "/").split("/").pop() ?? file).replace(/\.exe$/i, "");

const NEXT = "Restart it with ↻ in its tab, or open another shell from +.";

function reason(err: string): string {
  if (/not found|cannot find|no such file|os error 2|program not found/i.test(err)) {
    return "it isn't installed, or isn't on PATH.";
  }
  if (/access is denied|permission denied|os error 5/i.test(err)) {
    return "Windows denied access to it.";
  }
  if (/unknown command|not allowed|ipc/i.test(err)) {
    return "the app's terminal backend didn't answer.";
  }
  return "it failed to start.";
}

export function attachFailedMessage(shellFile: string, err: unknown): string {
  const raw = String(err);
  return `\r\n${RED}Couldn't start ${shellName(shellFile)} — ${reason(raw)}${RESET}\r\n${NEXT}\r\n${DIM}${raw}${RESET}\r\n`;
}

export function exitedWithoutOutputMessage(
  shellFile: string,
  code: number | null | undefined,
): string {
  return `\r\n${RED}${shellName(shellFile)} closed right after starting (exit code ${code ?? "?"}).${RESET}\r\n${NEXT}\r\n`;
}

export function unresponsiveMessage(retries: number): string {
  return `\r\n${RED}This terminal stopped responding (${retries} reconnect attempts failed).${RESET}\r\n${NEXT}\r\n`;
}
