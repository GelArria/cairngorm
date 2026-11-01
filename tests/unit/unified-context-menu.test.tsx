import { ContextMenu } from "@/common/components/context-menu";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { UnifiedContextMenu } from "@/common/components/unified-context-menu";
import type { ContextMenuItem } from "@/common/model/context-menu";
import { groups } from "@/common/model/context-menu";

const sampleItems = (): ContextMenuItem[] => [
  { label: "Edit", action: vi.fn(), shortcut: "F2" },
  { label: "Copy", action: vi.fn() },
  { separator: true, label: "", action: vi.fn() },
  { label: "Delete", action: vi.fn(), danger: true },
  { label: "Disabled", action: vi.fn(), disabled: true },
];

describe("UnifiedContextMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders menu items", () => {
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />);
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("renders a separator (role + hairline)", () => {
    const { container } = render(
      <UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('[role="separator"].h-px')).toBeTruthy();
  });

  it("shows a shortcut hint on the right", () => {
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />);
    expect(screen.getByText("F2")).toBeTruthy();
  });

  it("clicking item closes the menu, then calls the action", () => {
    const order: string[] = [];
    const action = vi.fn(() => order.push("action"));
    const close = vi.fn(() => order.push("close"));
    render(
      <UnifiedContextMenu x={10} y={10} items={[{ label: "Click Me", action }]} onClose={close} />,
    );
    fireEvent.click(screen.getByText("Click Me"));
    expect(order).toEqual(["close", "action"]);
  });

  it("disabled item does not call action and is marked aria-disabled", () => {
    const action = vi.fn();
    const close = vi.fn();
    render(
      <UnifiedContextMenu
        x={10}
        y={10}
        items={[{ label: "Nope", action, disabled: true }]}
        onClose={close}
      />,
    );
    const btn = screen.getByText("Nope").closest("button")!;
    fireEvent.click(btn);
    expect(action).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("danger item has text-red-400 class", () => {
    render(
      <UnifiedContextMenu
        x={10}
        y={10}
        items={[{ label: "Danger", action: vi.fn(), danger: true }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Danger").closest("button")!.className).toContain("text-red-400");
  });

  it("escape key closes menu", () => {
    const close = vi.fn();
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={close} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });

  it("click outside closes menu; right-click outside too", () => {
    const close = vi.fn();
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={close} />);
    fireEvent.mouseDown(document.body);
    fireEvent.contextMenu(document.body);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("arrow keys + Enter run an item, skipping separators and disabled rows", () => {
    const items = sampleItems();
    const close = vi.fn();
    render(<UnifiedContextMenu x={10} y={10} items={items} onClose={close} />);
    fireEvent.keyDown(document, { key: "ArrowDown" }); // Edit
    fireEvent.keyDown(document, { key: "ArrowDown" }); // Copy
    fireEvent.keyDown(document, { key: "ArrowDown" }); // (separator skipped) Delete
    fireEvent.keyDown(document, { key: "ArrowDown" }); // (Disabled skipped) wraps to Edit
    fireEvent.keyDown(document, { key: "ArrowUp" }); // back to Delete
    fireEvent.keyDown(document, { key: "Enter" });
    expect(items[3].action).toHaveBeenCalledTimes(1);
    expect(items[4].action).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("keys it handles never reach the app underneath", () => {
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />);
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    window.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("positions menu at x y coordinates", () => {
    const { container } = render(
      <UnifiedContextMenu x={100} y={200} items={sampleItems()} onClose={vi.fn()} />,
    );
    const menu = container.firstElementChild as HTMLElement;
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("200px");
  });

  it("is fixed, elevated and never shows icons (Zed style)", () => {
    const { container } = render(
      <UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />,
    );
    const menu = container.firstElementChild as HTMLElement;
    expect(menu.className).toContain("fixed");
    expect(menu.className).toContain("shadow-xl");
    expect(container.querySelector("i")).toBeNull();
  });

  it("renders buttons for non-separator items", () => {
    render(<UnifiedContextMenu x={10} y={10} items={sampleItems()} onClose={vi.fn()} />);
    expect(document.querySelectorAll("button").length).toBe(4);
  });
});

describe("groups()", () => {
  const a = (label: string): ContextMenuItem => ({ label, action: () => {} });
  it("joins non-empty groups with one separator, dropping falsy entries", () => {
    const out = groups([a("1"), false], [], [a("2"), null], [undefined]);
    expect(out.map((i) => (i.separator ? "—" : i.label))).toEqual(["1", "—", "2"]);
  });
});

import { useContextMenu } from "@/common/hooks/use-context-menu";

function Host({ children }: { children?: unknown }) {
  const cm = useContextMenu();
  return (
    <div
      data-testid="host"
      onContextMenu={(e) =>
        cm.open(e as unknown as MouseEvent, [{ label: "Item", action: () => {} }])
      }
    >
      <input data-testid="field" />
      <span data-testid="plain">x</span>
      <ContextMenu menu={cm.menu} />
    </div>
  );
}

describe("useContextMenu", () => {
  it("opens on right-click and cancels the native menu", async () => {
    render(<Host />);
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 5,
    });
    screen.getByTestId("plain").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(await screen.findByText("Item")).toBeTruthy();
  });

  it("leaves text fields alone (native Cut / Copy / Paste, no custom menu)", () => {
    render(<Host />);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByTestId("field").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByText("Item")).toBeNull();
  });
});
