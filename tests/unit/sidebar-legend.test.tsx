import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/preact";
import { SidebarLegend } from "@/common/layout/sidebar-legend";

describe("SidebarLegend", () => {
  it("shows the count and no add button without onAdd", () => {
    const { container, queryByLabelText } = render(<SidebarLegend label="Recent" count={3} />);
    expect(container.textContent).toContain("3");
    expect(queryByLabelText("New")).toBeNull();
  });

  it("offers a labelled + that fires onAdd while keeping the count", () => {
    const onAdd = vi.fn();
    const { container, getByLabelText } = render(
      <SidebarLegend label="Recent" count={3} onAdd={onAdd} addLabel="New conversation" />,
    );
    expect(container.textContent).toContain("3");
    fireEvent.click(getByLabelText("New conversation"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
