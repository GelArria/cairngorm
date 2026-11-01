import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/preact";
import { Resizable } from "@/common/components/resizable/resizable";
import { dragStep, foldProgress, isArmed } from "@/common/components/resizable/fold";

const limits = { minWidth: 260, collapsedWidth: 44 };
const options = (collapsed = false) => ({
  collapsed,
  canFold: true,
  canUnfold: true,
  clamp: (w: number) => Math.min(450, Math.max(260, w)),
});

describe("fold math", () => {
  it("resizes above the minimum and folds below it", () => {
    expect(dragStep(280, 40, limits, options())).toEqual({ mode: "resize", width: 320 });
    expect(dragStep(280, -100, limits, options())).toEqual({ mode: "collapse", width: 180 });
    expect(dragStep(280, -400, limits, options()).width).toBe(44);
  });

  it("never folds a panel that cannot fold", () => {
    const step = dragStep(280, -200, limits, { ...options(), canFold: false });
    expect(step).toEqual({ mode: "resize", width: 260 });
  });

  it("arms the fold halfway to the rail and the unfold earlier", () => {
    const shallow = { mode: "collapse" as const, width: 200 };
    const deep = { mode: "collapse" as const, width: 140 };
    expect(isArmed(shallow, limits)).toBe(false);
    expect(isArmed(deep, limits)).toBe(true);
    expect(foldProgress({ mode: "collapse", width: 44 }, limits)).toBe(1);
    expect(isArmed({ mode: "expand", width: 120 }, limits)).toBe(true);
    expect(isArmed({ mode: "expand", width: 80 }, limits)).toBe(false);
  });
});

function setup(props: Record<string, unknown> = {}) {
  const onCollapse = vi.fn();
  const onExpand = vi.fn();
  const view = render(
    <Resizable
      side="left"
      defaultWidth={280}
      minWidth={260}
      maxWidth={450}
      onCollapse={onCollapse}
      onExpand={onExpand}
      {...props}
    >
      <div>content</div>
    </Resizable>,
  );
  const root = view.container.firstElementChild as HTMLElement;
  const handle = view.container.querySelector(".cursor-col-resize")!;
  return { view, root, handle, onCollapse, onExpand };
}

describe("Resizable folding", () => {
  it("folds to the rail when released past the point of no return", () => {
    const { root, handle, onCollapse, view } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 100, buttons: 1 });
    expect(root.dataset.fold).toBe("collapse");
    expect(root.hasAttribute("data-armed")).toBe(true);
    expect(Number(root.style.getPropertyValue("--fold"))).toBeGreaterThan(0.5);
    fireEvent.mouseUp(window);
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(root.dataset.fold).toBeUndefined();
  });

  it("springs back to its width when released early, however fast it crossed", () => {
    const { root, handle, onCollapse, view } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    // Small steps resize first, then cross into the fold.
    for (const x of [295, 290, 285, 280, 250]) {
      fireEvent.mouseMove(window, { clientX: x, buttons: 1 });
    }
    expect(root.dataset.fold).toBe("collapse");
    fireEvent.mouseUp(window);
    expect(onCollapse).not.toHaveBeenCalled();
    expect(root.style.width).toBe("280px");
  });

  it("expands when the rail's edge is pulled outward", () => {
    const { root, handle, onExpand } = setup({ collapsed: true });
    expect(root.style.width).toBe("44px");
    fireEvent.mouseDown(handle, { clientX: 44 });
    fireEvent.mouseMove(window, { clientX: 160, buttons: 1 });
    expect(root.dataset.fold).toBe("expand");
    expect(root.style.width).toBe("160px");
    fireEvent.mouseUp(window);
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("mirrors the drag direction on the right side", () => {
    const { root, handle, onCollapse } = setup({ side: "right" });
    fireEvent.mouseDown(handle, { clientX: 700 });
    fireEvent.mouseMove(window, { clientX: 900, buttons: 1 });
    expect(root.dataset.fold).toBe("collapse");
    fireEvent.mouseUp(window);
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it("cancels a drag whose button was released out of sight", () => {
    const { root, handle, onCollapse } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 100, buttons: 1 });
    expect(root.hasAttribute("data-armed")).toBe(true);
    // Next move arrives with no button pressed (released in another window).
    fireEvent.mouseMove(window, { clientX: 100, buttons: 0 });
    fireEvent.mouseUp(window);
    expect(onCollapse).not.toHaveBeenCalled();
    expect(root.dataset.fold).toBeUndefined();
  });

  it("cancels when the window loses focus mid-drag", () => {
    const { root, handle, onCollapse } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 100, buttons: 1 });
    fireEvent.blur(window);
    fireEvent.mouseUp(window);
    expect(onCollapse).not.toHaveBeenCalled();
    expect(root.style.width).toBe("280px");
  });

  it("abandons a drag when the panel collapses by other means", () => {
    const { root, handle, onCollapse, view } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 100, buttons: 1 });
    view.rerender(
      <Resizable side="left" defaultWidth={280} minWidth={260} collapsed onCollapse={onCollapse}>
        <div>content</div>
      </Resizable>,
    );
    expect(root.style.width).toBe("44px");
    fireEvent.mouseUp(window);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("only resizes when folding is not enabled", () => {
    const { root, handle } = setup({ onCollapse: undefined, onExpand: undefined });
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 100, buttons: 1 });
    expect(root.dataset.fold).toBeUndefined();
    expect(root.style.width).toBe("260px");
    fireEvent.mouseUp(window);
  });

  it("does nothing on a plain click or a right-click on the rail edge", () => {
    const { root, handle, onExpand } = setup({ collapsed: true });
    fireEvent.mouseDown(handle, { clientX: 44 });
    expect(root.dataset.fold).toBeUndefined();
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(handle, { clientX: 44, button: 2 });
    fireEvent.mouseMove(window, { clientX: 200, buttons: 2 });
    expect(root.dataset.fold).toBeUndefined();
    fireEvent.mouseUp(window);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("detaches its listeners when unmounted mid-drag", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { handle, view } = setup();
    fireEvent.mouseDown(handle, { clientX: 300 });
    view.unmount();
    for (const type of ["mousemove", "mouseup", "blur"]) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });
});
