// @vitest-environment jsdom
// Right-click on a terminal pane / tab badge opens the pane menu
// (Rename pane / Split right / Split down / Zoom / Close pane).
// Ctrl+Shift+W closes the active pane.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
const shellFocus = vi.hoisted(() => vi.fn());
vi.mock("../../src/terminal/runtime/term-registry", () => ({ getTerm: vi.fn() }));
vi.mock("../../src/terminal/components/terminal-tab", () => ({ TerminalTab: () => null }));
vi.mock("../../src/terminal/data/terminal-window", () => ({
  detachTerminalWindow: vi.fn(async () => null),
  focusDetachedWindow: vi.fn(async () => undefined),
  closeDetachedWindow: vi.fn(async () => undefined),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({ useTerminalTabs: vi.fn() }));
vi.mock("@/common/layout/sidebar-side", () => ({ useSidebarSide: () => "left" }));

import { render, fireEvent, cleanup } from "@testing-library/preact";
import { TerminalTabs } from "../../src/terminal/components/terminal-tabs";
import { useTerminalTabs } from "../../src/terminal/hooks/use-terminal-tabs";
import { getTerm } from "../../src/terminal/runtime/term-registry";

function fakeStore(layoutOverride?: unknown) {
  const state = {
    groups: [{ id: "g1", name: "Group 1" }],
    activeGroupId: "g1",
    activeTabId: "t1",
    tabs: [
      { id: "t1", title: "A", status: "running", sessionId: "s1" },
      { id: "t2", title: "B", status: "running", sessionId: "s2" },
    ],
    layout: {
      cells: [
        { id: "c0", tabId: "t1", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        { id: "c1", tabId: "t2", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      ],
      columnCount: 2,
      columnRatios: [1, 1],
    },
  };
  const actions = {
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    updateTabStatus: vi.fn(),
    detachTab: vi.fn(),
    splitTab: vi.fn(),
    splitTabInner: vi.fn(),
    resizeColumns: vi.fn(),
    restartTab: vi.fn(),
    renameGroup: vi.fn(),
    renameTab: vi.fn(),
    moveCell: vi.fn(),
    swapCells: vi.fn(),
  };
  if (layoutOverride !== undefined) state.layout = layoutOverride;
  return {
    state,
    activeTab: state.tabs[0],
    inlineTabs: state.tabs,
    detachedTabs: [],
    ...actions,
  } as never;
}

beforeEach(() => {
  vi.mocked(useTerminalTabs).mockClear();
  vi.mocked(useTerminalTabs).mockReturnValue(fakeStore());
});

afterEach(() => {
  cleanup();
});

describe("terminal pane context menu", () => {
  it("pointer selection focuses the shell but keyboard selection stays on the tab", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.mocked(getTerm).mockReturnValue({
      focus: shellFocus,
      element: { offsetParent: null },
    } as never);
    try {
      const { getByRole } = render(<TerminalTabs />);
      const tab = getByRole("tab", { name: "B", exact: true });
      shellFocus.mockClear();
      fireEvent.click(tab, { detail: 1 });
      expect(shellFocus).toHaveBeenCalledOnce();
      shellFocus.mockClear();
      tab.focus();
      fireEvent.click(tab, { detail: 0 });
      expect(shellFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(tab);
    } finally {
      frame.mockRestore();
      vi.mocked(getTerm).mockReset();
    }
  });

  it("right-click on a pane opens the menu and Close pane calls closeTab", async () => {
    const { container } = render(<TerminalTabs />);
    const pane = container.querySelector('[data-pane-id="t1"]') as HTMLElement;
    fireEvent.contextMenu(pane);
    const menu = await import("../../src/terminal/components/terminal-pane-context-menu");
    expect(menu).toBeTruthy();
    const closeItem = Array.from(container.ownerDocument.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Close pane"),
    );
    expect(closeItem).toBeTruthy();
    fireEvent.click(closeItem!);
    const store = vi.mocked(useTerminalTabs).mock.results.at(-1)!.value as unknown as ReturnType<
      typeof fakeStore
    >;
    expect(store.closeTab).toHaveBeenCalledWith("t1");
  });

  it("Split right dispatches splitTab vertical; hotkey Ctrl+Shift+W closes the active tab", () => {
    const { container, unmount } = render(<TerminalTabs />);
    const pane = container.querySelector('[data-pane-id="t1"]') as HTMLElement;
    fireEvent.contextMenu(pane);
    const split = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Split right"),
    );
    fireEvent.click(split!);
    const store = vi.mocked(useTerminalTabs).mock.results.at(-1)!.value as unknown as ReturnType<
      typeof fakeStore
    >;
    expect(store.splitTab).toHaveBeenCalledWith("t1", "vertical");

    // jsdom has no layout; model a visible workspace for the hotkey guard.
    const visible = vi
      .spyOn(HTMLElement.prototype, "offsetParent", "get")
      .mockReturnValue(document.body);
    try {
      fireEvent.keyDown(document, { key: "W", ctrlKey: true, shiftKey: true });
      expect(store.closeTab).toHaveBeenCalledWith("t1");
    } finally {
      visible.mockRestore();
    }
    unmount();
  });

  it("Rename pane shows the inline input and commits on Enter", () => {
    const { container } = render(<TerminalTabs />);
    const paneT2 = container.querySelector('[data-pane-id="t2"]') as HTMLElement;
    fireEvent.contextMenu(paneT2);
    const rename = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Rename pane"),
    );
    expect(rename).toBeTruthy();
    fireEvent.click(rename!);
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.input(input!, { target: { value: "Build" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    const store = vi.mocked(useTerminalTabs).mock.results.at(-1)!.value as unknown as ReturnType<
      typeof fakeStore
    >;
    expect(store.renameTab).toHaveBeenCalledWith("t2", "Build");
  });

  it("Zoom pane is disabled without a split layout (would be inert)", () => {
    vi.mocked(useTerminalTabs).mockReturnValue(fakeStore(null));
    const { container } = render(<TerminalTabs />);
    fireEvent.contextMenu(container.querySelector('[data-pane-id="t1"]')!);
    const zoom = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Zoom pane"),
    ) as HTMLButtonElement | undefined;
    expect(zoom).toBeTruthy();
    expect(zoom!.getAttribute("aria-disabled")).toBe("true");
  });
});
