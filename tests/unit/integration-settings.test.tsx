import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/preact";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { IntegrationSettings } from "@/integrations/integration-settings";
import { IntegrationOnboarding } from "@/integrations/integration-onboarding";

const detected = {
  setupComplete: false,
  commitProvider: null,
  services: [
    {
      id: "codex",
      name: "Codex",
      cliPath: "C:/tools/codex.exe",
      homePath: "C:/Users/Dev/.codex",
      runtime: { binaryPath: "", homePath: "" },
      localSetup: true,
      status: "session-detected",
      authKind: "subscription",
      message: "Existing login found.",
    },
    {
      id: "claude",
      name: "Claude Code",
      cliPath: null,
      homePath: "C:/Users/Dev/.claude",
      runtime: { binaryPath: "", homePath: "" },
      localSetup: true,
      status: "not-installed",
      authKind: null,
      message: "Local setup found, but no runnable CLI.",
    },
  ],
};
const api = {
  provider: "openai",
  model: "saved-model",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  keySource: "none",
  keyHint: null,
};
// Node's own global localStorage shadows jsdom's here; a plain map stands in.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});
beforeEach(() => {
  store.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "detect_ai_services") return detected;
    if (cmd === "needs_ai_setup") return true;
    if (cmd === "get_agent_config") return api;
    if (cmd === "read_ai_usage") return [];
    if (cmd === "save_ai_runtime")
      return {
        ...detected,
        services: detected.services.map((s) =>
          s.id === args.id ? { ...s, runtime: args.runtime } : s,
        ),
      };
  });
});

type View = ReturnType<typeof render>;
const row = (view: View, id: string) => within(view.getByTestId(`integration-${id}`));
const verifyButton = (view: View, id: string) =>
  row(view, id).getByRole("button", { name: /Verify/ });
const ready = async (view: View) =>
  within(await view.findByTestId("integration-codex")).findByText("Login detected");

describe("Cairngorm agent and subscriptions", () => {
  it("puts the Cairngorm agent first and asks before using detected subscriptions", async () => {
    const view = render(<IntegrationSettings open />);
    await ready(view);
    await waitFor(() =>
      expect((view.getByLabelText("Model") as HTMLInputElement).value).toBe("saved-model"),
    );
    expect(view.getByTestId("cairngorm-agent").textContent).toContain("Used by");
    const consent = await view.findByRole("dialog", { name: "Use your existing subscriptions?" });
    expect(within(consent).getByText("Codex")).toBeTruthy();
    expect(within(consent).queryByText("Claude Code")).toBeNull();
    const calls = invoke.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("connect_ai_service");
    expect(calls).not.toContain("save_agent_config");
    expect(view.queryByText("In use by Cairngorm")).toBeNull();
    expect(verifyButton(view, "claude").hasAttribute("disabled")).toBe(true);
    expect(
      view.getByText(/does not export logins, copy tokens or transfer subscriptions/),
    ).toBeTruthy();
  });
  it("shows a detected Claude login and plan without letting the agent use it", async () => {
    const claude = {
      ...detected.services[1],
      cliPath: "C:/tools/claude.exe",
      status: "api-key-required",
      login: { plan: "pro", subscription: true },
    };
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services")
        return { ...detected, services: [detected.services[0], claude] };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const view = render(<IntegrationSettings open />);
    await ready(view);
    const claudeRow = row(view, "claude");
    expect(claudeRow.getByText("Login detected")).toBeTruthy();
    expect(claudeRow.getByText("pro")).toBeTruthy();
    expect(claudeRow.getByText(/Cairngorm agent: needs an API key/)).toBeTruthy();
    expect(verifyButton(view, "claude").hasAttribute("disabled")).toBe(true);
  });
  it("verifies only after consent, then selects the subscription", async () => {
    const onDone = vi.fn();
    const view = render(<IntegrationSettings open onDone={onDone} />);
    await ready(view);
    fireEvent.click(await view.findByRole("button", { name: "Not now" }));
    expect(localStorage.getItem("cairngorm.subscriptionConsent")).toBe("declined");
    fireEvent.click(verifyButton(view, "codex"));
    expect(invoke).not.toHaveBeenCalledWith("connect_ai_service", expect.anything());
    fireEvent.click(await view.findByRole("button", { name: "Allow" }));
    await view.findByText("In use by Cairngorm");
    expect(invoke).toHaveBeenCalledWith("connect_ai_service", { id: "codex" });
    expect(invoke.mock.calls.some((c) => c[0] === "save_agent_config")).toBe(false);
    fireEvent.click(view.getByText("Continue to Cairngorm"));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith("finish_ai_setup", { useApi: false });
  });
  it("declining consent withdraws a subscription already in use, keeping onboarding open", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services") return { ...detected, commitProvider: "codex" };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const onDone = vi.fn();
    const view = render(<IntegrationSettings open onDone={onDone} />);
    await ready(view);
    fireEvent.click(await view.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("finish_ai_setup", { useApi: true }));
    await waitFor(() => expect(view.queryByText("In use by Cairngorm")).toBeNull());
    expect(onDone).not.toHaveBeenCalled();
  });
  it("asks again with Google's account warning before using Gemini CLI after Codex consent", async () => {
    localStorage.setItem("cairngorm.subscriptionConsent", "granted");
    const gemini = {
      ...detected.services[0],
      id: "gemini",
      name: "Gemini CLI",
      cliPath: "C:/npm/node_modules/@google/gemini-cli/bundle/gemini.js",
      homePath: "C:/Users/Dev/.gemini",
    };
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services")
        return { ...detected, services: [...detected.services, gemini] };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const view = render(<IntegrationSettings open />);
    await ready(view);
    const dialog = await view.findByTestId("subscription-consent");
    expect(dialog.textContent).toContain("Google may restrict accounts");
    expect(invoke).not.toHaveBeenCalledWith("connect_ai_service", expect.anything());
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));
    await waitFor(() =>
      expect(localStorage.getItem("cairngorm.geminiSubscriptionConsent")).toBe("granted"),
    );
  });
  it("failed verification keeps the currently selected provider", async () => {
    localStorage.setItem("cairngorm.subscriptionConsent", "granted");
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services") return { ...detected, commitProvider: "claude" };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
      throw new Error("Quota unavailable");
    });
    const view = render(<IntegrationSettings open />);
    await ready(view);
    fireEvent.click(verifyButton(view, "codex"));
    await view.findByText(/Quota unavailable/);
    expect(view.getByTestId("integration-claude").textContent).toContain("In use by Cairngorm");
    expect(view.getByTestId("integration-codex").textContent).not.toContain("In use by Cairngorm");
  });
  it("requires exact typed API acknowledgement for Claude even after Codex consent", async () => {
    localStorage.setItem("cairngorm.subscriptionConsent", "granted");
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services")
        return {
          ...detected,
          services: detected.services.map((service) =>
            service.id === "claude"
              ? {
                  ...service,
                  cliPath: "C:/tools/claude.exe",
                  status: "session-detected",
                  authKind: "api-or-custom",
                }
              : service,
          ),
        };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const view = render(<IntegrationSettings open />);
    const dialog = await view.findByRole("dialog", { name: "Claude Code uses paid API billing" });
    const confirm = within(dialog).getByRole("button", { name: "Verify & enable API billing" });
    const acknowledgement = within(dialog).getByLabelText(
      "Type I understand to authorize API billing",
    );
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(invoke.mock.calls.some((call) => call[0] === "connect_ai_service")).toBe(false);
    fireEvent.input(acknowledgement, { target: { value: "i understand" } });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.input(acknowledgement, { target: { value: "I understand" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("connect_ai_service", {
        id: "claude",
        acknowledgement: "I understand",
      }),
    );
    await view.findByText("In use by Cairngorm");
  });
  it("switches back to the endpoint only when asked", async () => {
    localStorage.setItem("cairngorm.subscriptionConsent", "granted");
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services") return { ...detected, commitProvider: "codex" };
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const view = render(<IntegrationSettings open />);
    await ready(view);
    expect(invoke).not.toHaveBeenCalledWith("finish_ai_setup", { useApi: true });
    fireEvent.click(await view.findByText("Use this endpoint instead"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("finish_ai_setup", { useApi: true }));
  });
  it("saves paths once and forbids verifying unsaved paths", async () => {
    localStorage.setItem("cairngorm.subscriptionConsent", "granted");
    const view = render(<IntegrationSettings open />);
    await ready(view);
    fireEvent.click(row(view, "codex").getByRole("button", { name: /Configure/ }));
    fireEvent.input(row(view, "codex").getByLabelText("Binary path"), {
      target: { value: "C:/tools/new-codex.exe" },
    });
    fireEvent.input(view.getByLabelText("CODEX_HOME path"), {
      target: { value: "C:/accounts/codex" },
    });
    await waitFor(() => expect(verifyButton(view, "codex").hasAttribute("disabled")).toBe(true));
    fireEvent.click(row(view, "codex").getByRole("button", { name: "Save paths & scan" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_ai_runtime", {
        id: "codex",
        runtime: { binaryPath: "C:/tools/new-codex.exe", homePath: "C:/accounts/codex" },
      }),
    );
    await waitFor(() => expect(verifyButton(view, "codex").hasAttribute("disabled")).toBe(false));
  });
  it("keeps the endpoint form usable when detection fails", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "detect_ai_services") throw new Error("Cannot scan");
      if (cmd === "get_agent_config") return api;
      if (cmd === "read_ai_usage") return [];
    });
    const view = render(<IntegrationSettings open />);
    await view.findByText(/Cannot scan/);
    await waitFor(() =>
      expect((view.getByLabelText("Model") as HTMLInputElement).value).toBe("saved-model"),
    );
    invoke.mockImplementation(async (cmd) =>
      cmd === "detect_ai_services" ? detected : cmd === "read_ai_usage" ? [] : api,
    );
    fireEvent.click(view.getByRole("button", { name: "Scan again" }));
    await ready(view);
    expect(view.queryByText(/Cannot scan/)).toBeNull();
  });
  it("remembers the remaining-usage preference", async () => {
    const view = render(<IntegrationSettings open />);
    await ready(view);
    const toggle = view.getByRole("switch", { name: "Show remaining usage" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(localStorage.getItem("cairngorm.usage.showRemaining")).toBe("1");
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  });
  it("opens onboarding only after the splash when setup is pending", async () => {
    const view = render(<IntegrationOnboarding ready={false} />);
    expect(invoke).not.toHaveBeenCalled();
    view.rerender(<IntegrationOnboarding ready />);
    await view.findByRole("dialog", { name: "Set up the Cairngorm agent" });
    view.unmount();
    invoke.mockImplementation(async () => false);
    const completed = render(<IntegrationOnboarding ready />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("needs_ai_setup"));
    expect(completed.queryByRole("dialog")).toBeNull();
  });
});
