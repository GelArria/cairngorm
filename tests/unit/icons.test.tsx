import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/preact";
import { Icon } from "@/common/ui/icon";
import { StarIcon, ChevronIcon, SidebarIcon } from "@/common/ui/animated-icon";

describe("Icon", () => {
  it("renders a Lucide svg sized in em, so text-* classes size it", () => {
    const { container } = render(<Icon name="git-branch" class="text-xs" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("1em");
    expect(svg.getAttribute("height")).toBe("1em");
    expect(svg.getAttribute("class")).toContain("text-xs");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("animated icons", () => {
  it("star pops only when it becomes pinned — not on mount, not after the pop", () => {
    const r = render(<StarIcon filled />);
    const cls = () => r.container.querySelector("svg")!.getAttribute("class") ?? "";
    expect(cls()).not.toContain("ai-pop-in"); // mounted already pinned
    r.rerender(<StarIcon filled={false} />);
    r.rerender(<StarIcon filled />);
    expect(cls()).toContain("ai-pop-in");
    fireEvent.animationEnd(r.container.querySelector("svg")!);
    expect(cls()).not.toContain("ai-pop-in");
  });

  it("chevron carries its open state as a rotation class", () => {
    const { container, rerender } = render(<ChevronIcon open={false} />);
    expect(container.querySelector("svg")!.getAttribute("class")).not.toContain("ai-open");
    rerender(<ChevronIcon open />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("ai-open");
  });

  it("SidebarIcon uses the animated variant when one exists, else the static icon", () => {
    const a = render(<SidebarIcon name="magnifying-glass" />);
    expect(a.container.querySelector("svg")!.getAttribute("class")).toContain("ai-search");
    const s = render(<SidebarIcon name="folder-open" />);
    expect(s.container.querySelector("svg")!.getAttribute("class")).not.toContain("ai ");
  });
});
