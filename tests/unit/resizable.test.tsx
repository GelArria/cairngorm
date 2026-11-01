import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Resizable } from "@/common/components/resizable/resizable";

describe("Resizable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with default width", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe("240px");
  });

  it("shows resize handle when not collapsed", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).toBeTruthy();
  });

  it("handle has cursor-col-resize class", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle?.className).toContain("cursor-col-resize");
  });

  it("collapsed state hides handle", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240} collapsed>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).toBeNull();
  });

  it("collapsed uses collapsedWidth", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240} collapsed collapsedWidth={44}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe("44px");
  });

  it("sets body cursor on mousedown", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize")!;
    fireEvent.mouseDown(handle);
    expect(document.body.style.cursor).toBe("col-resize");
  });

  it("sets userSelect none on mousedown", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize")!;
    fireEvent.mouseDown(handle);
    expect(document.body.style.userSelect).toBe("none");
  });

  it("attaches mousemove listener on mousedown", () => {
    const spy = vi.spyOn(window, "addEventListener");
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize")!;
    fireEvent.mouseDown(handle);
    expect(spy).toHaveBeenCalledWith("mousemove", expect.any(Function));
  });

  it("cleans up on mouseup after drag", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize")!;
    fireEvent.mouseDown(handle);
    fireEvent.mouseUp(window);
    expect(document.body.style.cursor).toBe("");
  });

  it("removes mousemove listener on cleanup", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const handle = container.querySelector(".cursor-col-resize")!;
    fireEvent.mouseDown(handle);
    fireEvent.mouseUp(window);
    expect(spy).toHaveBeenCalledWith("mousemove", expect.any(Function));
  });

  it("handle sits after content for left side (flex order)", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const handle = wrapper.querySelector(".cursor-col-resize");
    expect(wrapper.lastElementChild).toBe(handle);
  });

  it("handle sits before content for right side (flex order)", () => {
    const { container } = render(
      <Resizable side="right" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const handle = wrapper.querySelector(".cursor-col-resize");
    expect(handle?.className).toContain("order-first");
    expect(wrapper.firstElementChild?.textContent).toBe("content");
  });

  it("fills horizontal space and keeps the child mounted across edge changes", () => {
    const view = render(
      <Resizable side="left" defaultWidth={240}>
        <div data-testid="kept-panel" />
      </Resizable>,
    );
    const child = view.container.querySelector('[data-testid="kept-panel"]');
    view.rerender(
      <Resizable side="right" defaultWidth={240}>
        <div data-testid="kept-panel" />
      </Resizable>,
    );
    expect(view.container.querySelector('[data-testid="kept-panel"]')).toBe(child);
    view.rerender(
      <Resizable side="left" defaultWidth={240} fullWidth>
        <div data-testid="kept-panel" />
      </Resizable>,
    );
    expect(view.container.querySelector('[data-testid="kept-panel"]')).toBe(child);
    expect((view.container.firstElementChild as HTMLElement).style.width).toBe("100%");
    expect(view.container.querySelector(".cursor-col-resize")).toBeNull();
  });

  it("renders children inside the wrapper", () => {
    render(
      <Resizable side="left" defaultWidth={240}>
        <div data-testid="child">child</div>
      </Resizable>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("wrapper is a flex row", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("flex");
  });

  it("wrapper has overflow hidden when collapsed", () => {
    const { container } = render(
      <Resizable side="left" defaultWidth={240} collapsed>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.overflow).toBe("hidden");
  });
});
