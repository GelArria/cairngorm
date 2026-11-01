/** Native tool result formats: pi content blocks and shell tools' stdout/output. */
export function toolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const result = value as Record<string, unknown>;
  if (Array.isArray(result.content)) {
    return result.content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  for (const key of ["stdout", "output", "text"]) {
    if (typeof result[key] === "string") {
      return result[key];
    }
  }
  return "";
}

export function toolCommand(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  const value = args as Record<string, unknown>;
  return typeof value.command === "string"
    ? value.command
    : typeof value.cmd === "string"
      ? value.cmd
      : "";
}

export function toolExitCode(value: unknown): number | undefined {
  if (!value || typeof value !== "object") {
    return;
  }
  const details = (value as { details?: { exitCode?: unknown } }).details;
  return typeof details?.exitCode === "number" ? details.exitCode : undefined;
}
