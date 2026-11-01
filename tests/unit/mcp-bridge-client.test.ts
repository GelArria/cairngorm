import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { clientLabel } = require("../../src/plugins/assets/mcp-bridge.cjs") as {
  clientLabel: (message: unknown) => string | null;
};

const initialize = (clientInfo: unknown) => ({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", clientInfo },
});

describe("MCP bridge client label", () => {
  it("keeps the agent's own name and version from the handshake", () => {
    expect(clientLabel(initialize({ name: "claude-code", version: "2.1.4" }))).toBe(
      "claude-code/2.1.4",
    );
    expect(clientLabel(initialize({ name: "codex-mcp-client", version: "0.46.0" }))).toBe(
      "codex-mcp-client/0.46.0",
    );
  });

  it("drops characters that are unsafe in a header and caps the length", () => {
    expect(clientLabel(initialize({ name: "evil\r\nx-other: 1", version: 3 }))).toBe(
      "evilx-other 1/",
    );
    expect(clientLabel(initialize({ name: "a".repeat(200) }))!.length).toBe(80);
  });

  it("ignores other messages and malformed client info", () => {
    expect(clientLabel({ method: "tools/list" })).toBeNull();
    expect(clientLabel(initialize({ version: "1" }))).toBeNull();
    expect(clientLabel(null)).toBeNull();
  });
});
