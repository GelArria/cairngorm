import type { Terminal } from "@xterm/xterm";

// Historical queries must not send fresh replies to a shell now at its prompt.
// Keep the parser (including image/mouse state) intact; suppress only reports.
export function writeTerminalReplay(term: Terminal, data: string | Uint8Array) {
  const handlers = [
    { final: "c" },
    { prefix: ">", final: "c" },
    { prefix: "=", final: "c" },
    { final: "n" },
    { prefix: "?", final: "n" },
  ].map((id) => term.parser.registerCsiHandler(id, () => true));
  term.write(data, () => handlers.forEach((handler) => handler.dispose()));
}
