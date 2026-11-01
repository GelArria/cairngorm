function ts(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

export function debugLog(source: string, event: string, details = ""): void {
  console.log(`[${ts()}] [${source}] ${event}${details ? " | " + details : ""}`);
}
