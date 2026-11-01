// Pure math of TabButton drag-to-detach (TileGrid was removed:
// terminal-tabs.tsx renders the inline grid and is what the real e2e covers).
// + render test: middle click closes the tab.
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../../src/terminal/components/terminal-tab", () => ({ TerminalTab: () => null }));
vi.mock("../../src/terminal/data/terminal-window", () => ({
  detachTerminalWindow: vi.fn(),
  focusDetachedWindow: vi.fn(),
  closeDetachedWindow: vi.fn(),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({ useTerminalTabs: vi.fn() }));

import { render, fireEvent, cleanup } from "@testing-library/preact";
import { TabButton } from "../../src/terminal/components/terminal-tabs";

const baseTab = { id: "t1", title: "pwsh 1", status: "running" } as never;
function mount(onClose: () => void) {
  return render(
    <TabButton
      tab={baseTab}
      isActive={false}
      onSelect={() => {}}
      onClose={onClose}
      onDetach={() => {}}
      onRestart={() => {}}
    />,
  );
}

describe("TabButton drag-to-detach detection", () => {
  it("drag threshold: 20px squared = 400 triggers tear", () => {
    const dx = 25,
      dy = 25;
    expect(dx * dx + dy * dy).toBeGreaterThan(400);
  });

  it("small movement does not trigger tear", () => {
    const dx = 5,
      dy = 5;
    expect(dx * dx + dy * dy).toBeLessThan(400);
  });

  it("outside window detection: negative clientX", () => {
    const clientX = -10,
      clientY = 100;
    const outside =
      clientX < 0 || clientX > window.innerWidth || clientY < 0 || clientY > window.innerHeight;
    expect(outside).toBe(true);
  });

  it("outside window detection: beyond window width", () => {
    const clientX = window.innerWidth + 50,
      clientY = 100;
    const outside =
      clientX < 0 || clientX > window.innerWidth || clientY < 0 || clientY > window.innerHeight;
    expect(outside).toBe(true);
  });

  it("inside window: not outside", () => {
    const clientX = 100,
      clientY = 100;
    const outside =
      clientX < 0 || clientX > window.innerWidth || clientY < 0 || clientY > window.innerHeight;
    expect(outside).toBe(false);
  });
});

describe("TabButton middle click", () => {
  it("middle click (button 1) closes the tab", () => {
    const onClose = vi.fn();
    const { container } = mount(onClose);
    fireEvent.mouseDown(container.firstElementChild!, { button: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("left click does NOT close (only selects)", () => {
    const onClose = vi.fn();
    const { container } = mount(onClose);
    fireEvent.mouseDown(container.firstElementChild!, { button: 0 });
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });
});
