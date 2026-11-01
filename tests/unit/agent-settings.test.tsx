import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { AgentSettings } from "@/agent/agent-settings";
import { presetOf } from "@/agent/data/agent-config";

const saved = {
  provider: "ollama",
  model: "gemma4:31b",
  baseUrl: "https://ollama.com/v1",
  apiKeyEnv: "OLLAMA_API_KEY",
  keySource: "saved",
  keyHint: "abcd",
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, any>) => {
    if (cmd === "get_agent_config") return saved;
    if (cmd === "save_agent_config")
      return {
        ...saved,
        ...args!.input,
        keySource: args!.input.apiKey ? "saved" : saved.keySource,
        keyHint: args!.input.apiKey?.slice(-4) ?? saved.keyHint,
      };
    if (cmd === "test_agent_connection")
      return { ok: true, message: "Connected · 2 models", models: ["gpt-4o", "gpt-4o-mini"] };
    throw new Error("unknown " + cmd);
  });
});

describe("presetOf", () => {
  it("matches provider + base URL (trailing slash / case ignored), else custom", () => {
    expect(presetOf({ provider: "ollama", baseUrl: "https://ollama.com/v1/" }).id).toBe(
      "ollama-cloud",
    );
    expect(presetOf({ provider: "ollama", baseUrl: "http://localhost:11434/v1" }).id).toBe(
      "ollama-local",
    );
    expect(presetOf({ provider: "openai", baseUrl: "https://my-proxy.internal/v1" }).id).toBe(
      "custom",
    );
  });
});

describe("AgentSettings (BYOK)", () => {
  it("a saved provider on a non-preset URL opens clean (no phantom changes) and keeps its provider", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, any>) => {
      if (cmd === "get_agent_config") return { ...saved, baseUrl: "http://192.168.1.5:11434/v1" };
      if (cmd === "save_agent_config") return { ...saved, ...args!.input };
      return { ok: true, message: "", models: [] };
    });
    const view = render(<AgentSettings open />);
    await waitFor(() => expect(view.getByTestId("agent-provider").textContent).toContain("Custom"));
    expect((view.getByTestId("agent-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(view.getByLabelText("Model"), { target: { value: "qwen3" } });
    fireEvent.click(view.getByTestId("agent-save"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_agent_config",
        expect.objectContaining({
          input: expect.objectContaining({ provider: "ollama", model: "qwen3" }),
        }),
      ),
    );
  });

  it("accepts a custom inference endpoint and model without requiring a preset company", async () => {
    const view = render(<AgentSettings open />);
    await waitFor(() =>
      expect(view.getByTestId("agent-provider").textContent).toContain("Ollama Cloud"),
    );
    fireEvent.click(view.getByTestId("agent-provider"));
    fireEvent.click(await view.findByText("Custom endpoint (OpenAI-compatible)"));
    fireEvent.input(view.getByLabelText("Base URL"), {
      target: { value: "https://inference.example/v1" },
    });
    fireEvent.input(view.getByLabelText("Model"), {
      target: { value: "my-model-family/my-model" },
    });
    fireEvent.input(view.getByLabelText("Key environment variable"), {
      target: { value: "inference_key" },
    });
    fireEvent.click(view.getByTestId("agent-save"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_agent_config", {
        input: {
          provider: "openai",
          model: "my-model-family/my-model",
          baseUrl: "https://inference.example/v1",
          apiKeyEnv: "INFERENCE_KEY",
          apiKey: undefined,
          keyOptional: false,
        },
      }),
    );
    expect(invoke.mock.calls.some((c) => c[0] === "test_agent_connection")).toBe(false);
  });

  it("shows the saved provider and only the key's last 4 characters", async () => {
    const view = render(<AgentSettings open />);
    await waitFor(() =>
      expect(view.getByTestId("agent-provider").textContent).toContain("Ollama Cloud"),
    );
    expect(view.getByText("Saved · ends in abcd")).toBeTruthy();
    expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect((view.getByTestId("agent-save") as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
  });

  it("switching provider pre-fills its fields; Save sends them with the new key", async () => {
    const view = render(<AgentSettings open />);
    await waitFor(() =>
      expect(view.getByTestId("agent-provider").textContent).toContain("Ollama Cloud"),
    );
    fireEvent.click(view.getByTestId("agent-provider"));
    fireEvent.click(await view.findByText("OpenAI"));
    expect((view.getByLabelText("Base URL") as HTMLInputElement).value).toBe(
      "https://api.openai.com/v1",
    );
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "sk-test-9876" } });
    fireEvent.click(view.getByTestId("agent-save"));
    await waitFor(() => expect(view.getByTestId("agent-status").textContent).toContain("Saved"));
    expect(invoke).toHaveBeenCalledWith("save_agent_config", {
      input: {
        provider: "openai",
        model: "gpt-4o",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        apiKey: "sk-test-9876",
        keyOptional: false,
      },
    });
    expect(view.getByText("Saved · ends in 9876")).toBeTruthy();
  });

  it("Test connection reports the result and offers the provider's models", async () => {
    const view = render(<AgentSettings open />);
    await waitFor(() =>
      expect(view.getByTestId("agent-provider").textContent).toContain("Ollama Cloud"),
    );
    fireEvent.click(view.getByTestId("agent-test"));
    await waitFor(() =>
      expect(view.getByTestId("agent-status").textContent).toBe("Connected · 2 models"),
    );
    expect(invoke).toHaveBeenCalledWith("test_agent_connection", {
      baseUrl: "https://ollama.com/v1",
      apiKeyEnv: "OLLAMA_API_KEY",
      apiKey: null,
      useSaved: true,
      provider: "ollama",
    });
    expect(view.container.querySelectorAll("#agent-models option")).toHaveLength(2);
  });
});
