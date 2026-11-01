// @vitest-environment jsdom
// Pane drag: the REAL pane lifts and follows the cursor (translate on the
// same grid node), no text ghost. On drop/cancel the pane goes back.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/terminal/components/terminal-tab", () => ({ TerminalTab: () => null }));
vi.mock("../../src/terminal/data/terminal-window", () => ({
  detachTerminalWindow: vi.fn(async () => null),
  focusDetachedWindow: vi.fn(async () => undefined),
  closeDetachedWindow: vi.fn(async () => undefined),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({ useTerminalTabs: vi.fn() }));

import { render, fireEvent, cleanup } from "@testing-library/preact";
import { TerminalTabs } from "../../src/terminal/components/terminal-tabs";
import { useTerminalTabs } from "../../src/terminal/hooks/use-terminal-tabs";

function fakeStore() {
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
    moveCell: vi.fn(),
    swapCells: vi.fn(),
  };
  const inlineTabs = state.tabs;
  return {
    state,
    activeTab: state.tabs[0],
    inlineTabs,
    detachedTabs: [],
    ...actions,
  } as never;
}

let atPoint: Element | null = null;

beforeEach(() => {
  // jsdom does not implement elementFromPoint: the drag uses it for swap-preview
  if (!document.elementFromPoint)
    (document as never as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      atPoint;
  atPoint = null;
  vi.mocked(useTerminalTabs).mockClear();
  vi.mocked(useTerminalTabs).mockReturnValue(fakeStore());
});

function mountAndGrab() {
  const { container, unmount } = render(<TerminalTabs />);
  const pane = container.querySelector('[data-pane-id="t1"]') as HTMLElement;
  expect(pane).toBeTruthy();
  // Content belongs to the terminal; pane movement starts only on its grip.
  const grip = pane.querySelector("[data-pane-drag]")!;
  fireEvent.mouseDown(grip, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(document, { clientX: 130, clientY: 120, buttons: 1 });
  return { container, pane, unmount };
}

describe("pane drag: the real pane follows the mouse", () => {
  it("dragging pane content never starts a layout drag", () => {
    const { container, unmount } = render(<TerminalTabs />);
    const pane = container.querySelector('[data-pane-id="t1"]') as HTMLElement;
    fireEvent.mouseDown(pane, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 130, clientY: 120, buttons: 1 });
    expect(pane.classList.contains("pane-dragging")).toBe(false);
    fireEvent.mouseUp(document, { clientX: 130, clientY: 120, button: 0 });
    unmount();
    cleanup();
  });

  it("during the drag the pane carries .pane-dragging and translates with the delta", () => {
    const { pane, unmount } = mountAndGrab();
    expect(pane.classList.contains("pane-dragging")).toBe(true);
    // translate = mouse delta: the grab point stays under the cursor
    expect(pane.style.transform).toBe("translate(30px, 20px)");
    // No text ghost hanging from the body (the old approach)
    expect(
      [...document.body.children].some((el) => (el as HTMLElement).style.zIndex === "9999"),
    ).toBe(false);
    unmount();
    cleanup();
  });

  it("mouseup clears the lift (class and transform back to zero)", () => {
    const { pane, unmount } = mountAndGrab();
    fireEvent.mouseUp(document, { clientX: 130, clientY: 120, button: 0 });
    expect(pane.classList.contains("pane-dragging")).toBe(false);
    expect(pane.style.transform).toBe("");
    unmount();
    cleanup();
  });

  it("buttonless move (lost mouseup) cancels the drag without a phantom drop", () => {
    const { pane, unmount } = mountAndGrab();
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130, buttons: 0 });
    expect(pane.classList.contains("pane-dragging")).toBe(false);
    expect(pane.style.transform).toBe("");
    unmount();
    cleanup();
  });

  it("blur (Snip Tool/alt-tab steals the input) cancels the drag", () => {
    const { pane, unmount } = mountAndGrab();
    fireEvent.blur(window);
    expect(pane.classList.contains("pane-dragging")).toBe(false);
    expect(pane.style.transform).toBe("");
    unmount();
    cleanup();
  });

  it("swap contact: the dragged one turns transparent; losing contact restores it", () => {
    const { container, pane, unmount } = mountAndGrab();
    const target = container.querySelector('[data-pane-id="t2"]') as HTMLElement;
    // elementFromPoint → pane t2: valid contact → dragged transparent + target in preview
    atPoint = target;
    fireEvent.mouseMove(document, { clientX: 200, clientY: 110, buttons: 1 });
    expect(pane.classList.contains("swap-contact")).toBe(true);
    expect(target.classList.contains("swap-preview")).toBe(true);
    // nothing underneath: loses contact → turns opaque again
    atPoint = null;
    fireEvent.mouseMove(document, { clientX: 210, clientY: 110, buttons: 1 });
    expect(pane.classList.contains("swap-contact")).toBe(false);
    expect(target.classList.contains("swap-preview")).toBe(false);
    unmount();
    cleanup();
  });
});
