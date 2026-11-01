import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import { PluginSettings } from "@/plugins/plugin-settings";
import type { PluginsState } from "@/plugins/model/types";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let state: PluginsState;
beforeEach(() => {
  state = {
    plugins: ["tldraw", "drawio"].map((id) => ({
      id,
      name: id,
      description: "Diagrams",
      category: "Creativity",
      logo: "/plugins/tldraw.svg",
      homepage: "https://example.com",
      terms: "https://example.com/terms",
      auth: "none",
      enabled: false,
      signedIn: false,
    })),
    agents: [
      {
        id: "test-cli",
        name: "Example CLI",
        configPath: "/home/me/config.json",
        registered: false,
      },
    ],
    runtime: "node",
    agentsConnected: false,
    bridgeConfig: null,
    error: null,
  };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: { id: string; enabled: boolean }) => {
    if (cmd === "agent_configs_removed") {
      return false;
    }
    if (cmd === "plugins_connect_agents") {
      state.agentsConnected = true;
      state.agents[0].registered = true;
    } else if (cmd === "plugins_set_enabled") {
      state.plugins.find((p) => p.id === args!.id)!.enabled = args!.enabled;
    } else if (cmd !== "plugins_state") {
      throw new Error(`Unexpected command: ${cmd}`);
    }
    return structuredClone(state);
  });
});

async function settings() {
  const view = render(<PluginSettings open />);
  await view.findByRole("button", { name: "Add drawio" });
  return view;
}

describe("shared plugin connection", () => {
  it("cancel changes neither agent configs nor plugins; approval is reused for later plugins", async () => {
    const view = await settings();
    fireEvent.click(view.getByRole("button", { name: "Add tldraw" }));
    expect(view.getByRole("dialog", { name: "Connect plugins to your agents" })).toBeTruthy();
    expect(
      invoke.mock.calls.every(
        ([cmd]) => cmd === "plugins_state" || cmd === "agent_configs_removed",
      ),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(state.agentsConnected).toBe(false);

    fireEvent.click(view.getByRole("button", { name: "Add tldraw" }));
    fireEvent.click(view.getAllByRole("button", { name: "Connect agents", exact: true }).at(-1)!);
    await waitFor(() =>
      expect(view.getByTestId("plugin-card-tldraw").textContent).toContain("Added"),
    );
    expect(view.getByTestId("plugin-agent-test-cli").textContent).toContain("Restart required");
    expect(view.getByTestId("plugin-agent-test-cli").textContent).not.toContain("Connected");

    fireEvent.click(view.getByRole("button", { name: "Add drawio" }));
    await waitFor(() => expect(state.plugins[1].enabled).toBe(true));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "plugins_connect_agents")).toHaveLength(1);
  });

  it("existing plugins can connect without being removed or added again", async () => {
    state.plugins[0].enabled = true;
    const view = await settings();
    fireEvent.click(view.getByRole("button", { name: "Connect agents", exact: true }));
    fireEvent.click(view.getAllByRole("button", { name: "Connect agents", exact: true }).at(-1)!);
    await view.findByRole("button", { name: "Check agent connections" });
    expect(invoke.mock.calls.some(([cmd]) => cmd === "plugins_set_enabled")).toBe(false);
    expect(state.plugins[0].enabled).toBe(true);
  });

  it("does not enable a plugin when connecting the bridge fails", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((cmd, args) =>
      cmd === "plugins_connect_agents"
        ? Promise.reject(new Error("Runtime unavailable"))
        : original(cmd, args),
    );
    const view = await settings();
    fireEvent.click(view.getByRole("button", { name: "Add tldraw" }));
    fireEvent.click(view.getAllByRole("button", { name: "Connect agents", exact: true }).at(-1)!);
    expect((await view.findByRole("alert")).textContent).toContain("Runtime unavailable");
    expect(state.plugins[0].enabled).toBe(false);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "plugins_set_enabled")).toBe(false);
  });

  it("only reports Connected after a real gateway contact, and keeps errors visible", async () => {
    state.agentsConnected = true;
    state.plugins[0].enabled = true;
    state.agents[0] = { ...state.agents[0], registered: true, lastSeen: 42 };
    let view = await settings();
    expect(view.getByTestId("plugin-agent-test-cli").textContent).toContain("Connected");
    view.unmount();
    state.agents[0].error = "Configuration is unreadable";
    view = await settings();
    const row = view.getByTestId("plugin-agent-test-cli");
    expect(row.textContent).toContain("Not connected");
    expect(row.textContent).toContain("Configuration is unreadable");
    expect(row.textContent).not.toContain("Connected");
  });
});
