import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/preact";

// Layout: projects grid · selected project's modules · its terminals. A module
// (Calendar / Files / Git) replaces the terminal list; its button again = back.
// Files and Git never stack.
vi.mock("@/workspace/workspace-panel", () => ({
  WorkspacePanel: () => <div data-testid="files-panel" />,
}));
vi.mock("@/git/git-panel", () => ({ GitPanel: () => <div data-testid="git-panel" /> }));
vi.mock("@/git/hooks/use-git-status", () => ({
  useGitStatus: () => ({ files: [], root: null, branch: null }),
}));
vi.mock("@/sidebar/components/projects-grid", () => ({
  ProjectsGrid: () => <div data-testid="grid" />,
}));
vi.mock("@/sidebar/components/project-terminals", () => ({
  ProjectTerminals: () => <div data-testid="projects" />,
}));
vi.mock("@/sidebar/components/active-project-header", () => ({
  ActiveProjectHeader: (p: { open: string | null; onToggle: (m: string) => void }) => (
    <div data-testid="modules" data-open={p.open ?? ""}>
      {["calendar", "files", "git"].map((m) => (
        <button key={m} data-testid={`open-${m}`} onClick={() => p.onToggle(m)} />
      ))}
    </div>
  ),
}));
vi.mock("@/projects", () => ({
  pickAndCreateProject: vi.fn(),
  switchProject: vi.fn(),
  useActiveProject: () => ({ id: "p1" }),
}));
vi.mock("@/app/lazy-views", () => ({
  LazyCalendarView: () => <div data-testid="calendar-panel" />,
}));
// The fold ghost is decorative (shown only while dragging the edge).
vi.mock("@/sidebar/components/sidebar-fold-ghost", () => ({ SidebarFoldGhost: () => null }));
vi.mock("@/sidebar/components/sidebar-footer", () => ({ SidebarFooter: () => <div /> }));

describe("AppSidebar panels", () => {
  afterEach(cleanup);
  beforeEach(async () => {
    (await import("@/common/layout/sidebar-side")).setSidebarSide("left");
    try {
      window.localStorage.removeItem("sidebar-git-open");
    } catch {
      /* no storage */
    }
  });

  it("Git replaces the terminal list (project header stays); its button again returns", async () => {
    const { render, fireEvent } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const view = render(<AppSidebar activeMode="chat" explorerOpen={false} />);
    fireEvent.click(view.getByTestId("open-git"));
    expect(view.queryByTestId("git-panel")).toBeTruthy();
    expect(view.queryByTestId("projects")).toBeNull();
    // Projects live in the header's picker, which stays above any module.
    expect(view.queryByTestId("modules")).toBeTruthy();
    fireEvent.click(view.getByTestId("open-git"));
    expect(view.queryByTestId("git-panel")).toBeNull();
    expect(view.queryByTestId("projects")).toBeTruthy();
    expect(view.queryByTestId("open-workspace")).toBeNull();
  }, 20_000);

  it("Files (Ctrl+B elsewhere) closes Git; closing Files shows Projects, not a stale Git", async () => {
    const { render, fireEvent } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const props = { activeMode: "chat" as const, onToggleExplorer: vi.fn() };
    const view = render(<AppSidebar {...props} explorerOpen={false} />);
    fireEvent.click(view.getByTestId("open-git"));
    view.rerender(<AppSidebar {...props} explorerOpen={true} />);
    expect(view.queryByTestId("git-panel")).toBeNull();
    expect(view.getByTestId("modules").dataset.open).toBe("files");
    view.rerender(<AppSidebar {...props} explorerOpen={false} />);
    expect(view.queryByTestId("git-panel")).toBeNull();
    expect(view.queryByTestId("projects")).toBeTruthy();
  }, 20_000);

  it("Calendar selects its sidebar panel; its button again returns to the terminal list", async () => {
    const { render, fireEvent } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const onModeChange = vi.fn();
    const view = render(
      <AppSidebar activeMode="chat" onModeChange={onModeChange} explorerOpen={false} />,
    );
    fireEvent.click(view.getByTestId("open-calendar"));
    expect(onModeChange).toHaveBeenLastCalledWith("calendar");
    view.rerender(
      <AppSidebar activeMode="calendar" onModeChange={onModeChange} explorerOpen={false} />,
    );
    expect(view.getByTestId("modules").dataset.open).toBe("calendar");
    fireEvent.click(view.getByTestId("open-calendar"));
    expect(onModeChange).toHaveBeenLastCalledWith("chat");
  }, 20_000);

  it("opening Files deselects Calendar instead of keeping a hidden calendar selection", async () => {
    const { render, fireEvent } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const onModeChange = vi.fn();
    const onToggleExplorer = vi.fn();
    const props = { activeMode: "calendar" as const, onModeChange, onToggleExplorer };
    const view = render(<AppSidebar {...props} explorerOpen={true} />);
    expect(view.getByTestId("modules").dataset.open).toBe("files");
    fireEvent.click(view.getByTestId("open-files"));
    expect(onToggleExplorer).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("chat");
  }, 20_000);

  it("has no conversation filter any more", async () => {
    const { render } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const view = render(<AppSidebar activeMode="chat" explorerOpen={false} />);
    expect(view.container.querySelector("[data-sidebar-filter]")).toBeNull();
    expect(view.queryByPlaceholderText("Filter conversations")).toBeNull();
  }, 20_000);

  it("follows the sidebar side: border and resize handle face the content", async () => {
    const { render, act } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    const side = await import("@/common/layout/sidebar-side");
    act(() => side.setSidebarSide("left"));
    const view = render(<AppSidebar activeMode="chat" explorerOpen={false} />);
    const shell = () => view.getByTestId("sidebar").closest("[style]") as HTMLElement;
    expect(view.getByTestId("sidebar").dataset.side).toBe("left");
    expect(shell().className).toContain("border-r");
    act(() => side.toggleSidebarSide());
    expect(view.getByTestId("sidebar").dataset.side).toBe("right");
    expect(shell().className).toContain("border-l");
    act(() => side.setSidebarSide("left"));
  }, 20_000);
});
