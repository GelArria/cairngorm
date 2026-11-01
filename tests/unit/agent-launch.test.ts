import { describe, it, expect } from "vitest";
import { agentShellEnv, AgentSetupError } from "../../src/terminal/data/agent-launch";
describe("native agent credential readiness", () => {
  it("passes no provider credentials through renderer launch state", () => {
    expect(
      agentShellEnv({
        apiKeyEnv: "TEST_KEY",
        keyAvailable: true,
        baseUrl: "http://internal/v1",
        model: "model",
      }),
    ).toEqual({});
  });
  it("refuses launch until a credential is available", () => {
    expect(() =>
      agentShellEnv({ apiKeyEnv: "TEST_KEY", keyAvailable: false, baseUrl: null, model: null }),
    ).toThrow(AgentSetupError);
  });
});
