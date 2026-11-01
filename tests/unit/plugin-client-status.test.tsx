import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/preact";
import { PluginAgents } from "@/plugins/components/plugin-agents";
import type { AgentRegistration } from "@/plugins/model/types";

afterEach(cleanup);

it("a catalog read proves MCP discovery, not model visibility", () => {
  const view = render(
    <PluginAgents
      agents={[
        {
          id: "unlisted",
          name: "Independent CLI",
          configPath: "mcp.json",
          registered: true,
          lastSeen: 1,
          activity: {
            id: "terminal:123",
            name: "Independent CLI",
            agent: null,
            registration: null,
            lastSeen: 1,
            synced: true,
          },
        },
      ]}
      anyEnabled
    />,
  );
  expect(view.getByTestId("plugin-agent-unlisted").textContent).toContain("Catalog read");
  expect(view.queryByText(/Tools synced|Model ready/)).toBeNull();
});

it("removing the last plugin keeps reload guidance until the client reads the empty catalog", () => {
  const agent: AgentRegistration = {
    id: "custom",
    name: "My CLI",
    configPath: "C:/agents/my-cli/mcp.json",
    registered: true,
    lastSeen: 1,
    activity: {
      id: "terminal:123",
      name: "My CLI",
      agent: null,
      registration: null,
      lastSeen: 1,
      synced: false,
    },
  };
  const view = render(<PluginAgents agents={[agent]} anyEnabled={false} />);
  expect(view.getByTestId("plugin-agent-custom").textContent).toContain("Refresh required");
  expect(view.getByTestId("plugin-agent-custom").textContent).toContain("Reload");
  view.rerender(
    <PluginAgents
      agents={[{ ...agent, activity: { ...agent.activity!, synced: true } }]}
      anyEnabled={false}
    />,
  );
  expect(view.getByTestId("plugin-agent-custom").textContent).toContain("Off");
  expect(view.queryByText("Refresh required")).toBeNull();
});
