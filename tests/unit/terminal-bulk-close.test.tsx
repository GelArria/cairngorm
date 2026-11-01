import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTerminalBulkClose } from "../../src/terminal/hooks/use-terminal-bulk-close";
import type { TermTab } from "../../src/terminal/model/types";

const tab = (id: string, options: Partial<TermTab> = {}): TermTab => ({
  id,
  title: id,
  sessionId: `session-${id}`,
  profile: "shell",
  status: "running",
  detached: false,
  isAgent: false,
  groupId: "one",
  ...options,
});
const tabs = [
  tab("shell"),
  tab("agent", { isAgent: true }),
  tab("detached", { detached: true }),
  tab("file", { kind: "file", isDirty: true }),
  tab("other", { groupId: "two" }),
];

afterEach(cleanup);

describe("terminal bulk close confirmation", () => {
  it("requires confirmation, counts terminals, and preserves files and other groups", () => {
    const closeTab = vi.fn();
    const { result } = renderHook(() => {
      const bulk = useTerminalBulkClose({
        tabs,
        groupId: "one",
        groupName: "Project One",
        closeTab,
      });
      return bulk;
    });
    expect(result.current.count).toBe(3);
    act(() => result.current.closeAll());
    expect(closeTab).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(true);
    // Render the hook's actual shared dialog, including destructive and cancel controls.
    render(<ConfirmDialog {...result.current.dialog} />);
    expect(screen.getByText(/Close 3 terminals in Project One/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close 3 terminals" }));
    expect(closeTab.mock.calls).toEqual([
      ["shell", true],
      ["agent", true],
      ["detached", true],
    ]);
  });

  it("cancel and Escape do not close any terminal", () => {
    const closeTab = vi.fn();
    const { result } = renderHook(() => useTerminalBulkClose({ tabs, groupId: "one", closeTab }));
    act(() => result.current.closeAll());
    const view = render(<ConfirmDialog {...result.current.dialog} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closeTab).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(false);
    view.unmount();
    act(() => result.current.closeAll());
    render(<ConfirmDialog {...result.current.dialog} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.confirming).toBe(false);
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("close others keeps the clicked terminal, and pending targets survive project switches", () => {
    const closeTab = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useTerminalBulkClose({ ...props, closeTab }),
      {
        initialProps: { tabs, groupId: "one", groupName: "One" },
      },
    );
    act(() => result.current.closeOthers("agent"));
    rerender({ tabs: [...tabs, tab("new")], groupId: "two", groupName: "Two" });
    render(<ConfirmDialog {...result.current.dialog} />);
    expect(screen.getByText(/Close 2 terminals in One/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close 2 terminals" }));
    expect(closeTab.mock.calls).toEqual([
      ["shell", true],
      ["detached", true],
    ]);
  });

  it("empty groups cannot open a destructive confirmation", () => {
    const { result } = renderHook(() =>
      useTerminalBulkClose({ tabs, groupId: "empty", closeTab: vi.fn() }),
    );
    act(() => result.current.closeAll());
    expect(result.current.confirming).toBe(false);
    expect(result.current.hasOthers("shell")).toBe(false);
  });
});
