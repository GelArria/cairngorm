import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import { Tooltip } from "@/common/ui/tooltip";
import { detectWindowPlatform } from "@/common/ui/window-controls";
import { resetBindings, setBinding, KEYBINDINGS_STORAGE_KEY } from "@/keybindings/data/keybindings";

// The real bug: tooltips with position:absolute inside containers with
// overflow-x-hidden (sidebar) get clipped at the panel edge, and
// persist after click. Fix: portal to body with position:fixed.

function wrapper(): HTMLElement {
  return screen.getByTestId("trigger").parentElement as HTMLElement;
}

/** Hover + the tooltip's short open delay. */
function hover() {
  fireEvent.mouseEnter(wrapper());
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

function renderInClippedContainer() {
  const clipped = document.createElement("div");
  clipped.style.cssText = "overflow-x: hidden; width: 100px; height: 40px;";
  document.body.appendChild(clipped);
  const utils = render(
    <Tooltip content="Calendar" side="right">
      <button data-testid="trigger">icon</button>
    </Tooltip>,
    { container: clipped },
  );
  return { ...utils, clipped };
}

describe("Tooltip portal", () => {
  it("detects desktop platforms from the webview user agent", () => {
    expect(detectWindowPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectWindowPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
    expect(detectWindowPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    });
    resetBindings();
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    resetBindings();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits a moment before opening (no flashing while the pointer travels)", () => {
    renderInClippedContainer();
    fireEvent.mouseEnter(wrapper());
    expect(screen.queryByText("Calendar")).toBeNull();
    fireEvent.mouseLeave(wrapper());
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText("Calendar")).toBeNull();
  });

  it("does not render content until hover", () => {
    renderInClippedContainer();
    expect(screen.queryByText("Calendar")).toBeNull();
  });

  it("on hover, renders OUTSIDE the clipping container (in body)", () => {
    const { clipped } = renderInClippedContainer();
    hover();
    const tip = screen.getByText("Calendar");
    // The tooltip lives in document.body, not inside the overflow container
    expect(tip.closest("div[style*='overflow-x']")).toBeNull();
    expect(clipped.contains(tip)).toBe(false);
    expect(document.body.contains(tip)).toBe(true);
  });

  it("rendered tooltip uses position:fixed (immune to panel overflow)", () => {
    renderInClippedContainer();
    hover();
    const tip = screen.getByText("Calendar");
    const positioned = tip.closest("div[style*='fixed'], div.fixed");
    expect(positioned).not.toBeNull();
  });

  it("closes when the mouse leaves", () => {
    renderInClippedContainer();
    hover();
    expect(screen.getByText("Calendar")).toBeTruthy();
    fireEvent.mouseLeave(wrapper());
    expect(screen.queryByText("Calendar")).toBeNull();
  });

  it("closes when clicking the trigger (does not persist after click)", () => {
    renderInClippedContainer();
    const trigger = screen.getByTestId("trigger");
    hover();
    expect(screen.getByText("Calendar")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText("Calendar")).toBeNull();
  });

  it("shows the live shortcut in parentheses, follows remapping, disable and reset", () => {
    render(
      <Tooltip content="Split vertically" shortcut="toggleSplit">
        <button data-testid="trigger">Split</button>
      </Tooltip>,
    );
    hover();
    expect(screen.getByRole("tooltip").textContent).toBe("Split vertically (Ctrl+\\)");
    act(() => {
      setBinding("toggleSplit", "Ctrl+Shift+K");
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Split vertically (Ctrl+Shift+K)");
    act(() => {
      setBinding("toggleSplit", null);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Split vertically");
    act(() => {
      resetBindings();
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Split vertically (Ctrl+\\)");
  });

  it("uses preferences changed in another window before hover and supports keyboard focus", () => {
    render(
      <Tooltip content="Calendar" shortcut="calendar">
        <button data-testid="trigger">Calendar</button>
      </Tooltip>,
    );
    act(() => {
      localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify({ calendar: "Ctrl+Shift+K" }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEYBINDINGS_STORAGE_KEY }));
    });
    fireEvent.focus(screen.getByTestId("trigger"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Calendar (Ctrl+Shift+K)");
    fireEvent.blur(screen.getByTestId("trigger"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps shortcut tooltips inside the viewport at the right edge", () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 24,
    } as DOMRect);
    render(
      <Tooltip content="Split horizontally" shortcut="splitHorizontal" side="bottom">
        <button data-testid="trigger">Split</button>
      </Tooltip>,
    );
    Object.defineProperty(wrapper(), "getBoundingClientRect", {
      value: () => ({ top: 10, bottom: 30, left: 990, right: 1010, width: 20, height: 20 }),
    });
    hover();
    const tip = screen.getByRole("tooltip");
    expect(Number(tip.style.left.replace("px", "")) + 100).toBe(1016);
  });

  it("positions to the right of the trigger when side='right'", () => {
    renderInClippedContainer();
    const wrap = wrapper();
    Object.defineProperty(wrap, "getBoundingClientRect", {
      value: () => ({
        top: 100,
        bottom: 120,
        left: 20,
        right: 40,
        width: 20,
        height: 20,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    hover();
    const tip = screen.getByText("Calendar") as HTMLElement;
    expect(Number(tip.style.left.replace("px", ""))).toBeGreaterThan(40); // right of trigger
    expect(Number(tip.style.top.replace("px", ""))).toBeGreaterThan(90);
  });
});
