import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
import { openAppTab, updateAppTabWindow } from "@/terminal/state/app-tab-actions";
import { currentState, setState } from "@/terminal/state/terminal-store";

beforeEach(() => {
  setState({
    tabs: ["a", "b"].map((id) => ({
      id,
      title: id,
      sessionId: `session-${id}`,
      profile: "pwsh",
      status: "idle",
      detached: false,
      groupId: id === "a" ? "g1" : "g2",
    })),
    groups: [
      { id: "g1", name: "First" },
      { id: "g2", name: "Second" },
    ],
    activeGroupId: "g1",
    activeTabId: "a",
    layout: null,
    savedLayouts: {},
  });
});
const open = (sessionId = "session-a", hwnd = "101") =>
  openAppTab({ sessionId, hwnd, appId: "excel", appName: "Excel", title: "Budget" });

it("updates an application's existing pane instead of duplicating it", () => {
  expect(open()).toBe(true);
  const id = currentState.tabs.find((tab) => tab.kind === "app")!.id;
  open("session-a", "102");
  expect(currentState.tabs.filter((tab) => tab.kind === "app")).toMatchObject([
    { id, appHwnd: "102" },
  ]);
});

it("does not give two terminals or projects control of the same native window", () => {
  open();
  setState((prev) => ({ ...prev, activeGroupId: "g2", activeTabId: "b" }));
  expect(open("session-b")).toBe(true);
  const apps = currentState.tabs.filter((tab) => tab.kind === "app");
  expect(apps).toHaveLength(1);
  expect(apps[0]).toMatchObject({ appHwnd: "101", appSourceTabId: "a", groupId: "g1" });
  expect(currentState.activeGroupId).toBe("g2");
  expect(currentState.activeTabId).toBe("b");
});

it("tracks the reopened handle and refuses a handle used by another pane", () => {
  open();
  const id = currentState.tabs.find((tab) => tab.kind === "app")!.id;
  updateAppTabWindow(id, "202");
  open("session-b", "202");
  expect(currentState.tabs.filter((tab) => tab.kind === "app")).toHaveLength(1);
  open("session-b", "303");
  expect(() => updateAppTabWindow(id, "303")).toThrow("already shown in another pane");
  expect(currentState.tabs.find((tab) => tab.id === id)?.appHwnd).toBe("202");
});

it("ignores events without a source terminal", () => {
  expect(open("closed-session")).toBe(false);
  expect(currentState.tabs.filter((tab) => tab.kind === "app")).toHaveLength(0);
});
