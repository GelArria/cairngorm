import { describe, it, expect, vi } from "vitest";

// The sidebar explorer must load its tree ONCE and keep it when the panel is
// closed/reopened (display toggle, not unmount). Regression for the
// open/close "dips + reload from scratch" bug.
const mockListDir = vi.fn().mockResolvedValue([
  { name: "alpha", path: "C:/Users/me/alpha", isDirectory: true },
  { name: "readme.md", path: "C:/Users/me/readme.md", isDirectory: false },
]);
const mockHomeDir = vi.fn().mockResolvedValue("C:/Users/me");

vi.mock("@/common/filesystem/fs-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/common/filesystem/fs-bridge")>()),
  openFolderDialog: vi.fn().mockResolvedValue(null),
  readFileContent: vi.fn().mockResolvedValue(""),
  readFileAsDataURL: vi.fn().mockResolvedValue(""),
  listDir: (...a: unknown[]) => mockListDir(...a),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: () => mockHomeDir(),
  join: (...s: string[]) => s.join("/"),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Stub the dynamic sidebar sections — the subject is the explorer wrapper
vi.mock("@/sidebar/components/projects-grid", () => ({ ProjectsGrid: () => <div /> }));
vi.mock("@/sidebar/components/project-terminals", () => ({ ProjectTerminals: () => <div /> }));
// No SQLite in jsdom: the projects store falls back to an in-memory "Home" project
vi.mock("@/common/storage/db", () => ({
  select: () => Promise.reject(new Error("no db")),
  execute: () => Promise.reject(new Error("no db")),
}));

describe("sidebar explorer keep-alive", () => {
  it("keeps the loaded tree mounted across close/open without refetching", async () => {
    const { render } = await import("@testing-library/preact");
    const { AppSidebar } = await import("@/sidebar/app-sidebar");
    await (await import("@/projects/api")).initProjects();

    const props = {
      activeMode: "chat" as const,
      explorerOpen: true,
    };
    const view = render(<AppSidebar {...props} />);

    // Tree loads once (the Home project's folder at startup)
    await vi.waitFor(() => expect(view.container.textContent).toContain("alpha"));
    expect(mockListDir).toHaveBeenCalledTimes(1);

    // Close: panel hidden but still mounted — tree stays in the DOM
    view.rerender(<AppSidebar {...props} explorerOpen={false} />);
    expect(view.container.textContent).toContain("alpha");

    // Reopen: same tree shown instantly, ONE listDir call total (no reload)
    view.rerender(<AppSidebar {...props} explorerOpen={true} />);
    expect(view.container.textContent).toContain("alpha");
    expect(mockListDir).toHaveBeenCalledTimes(1);
  }, 20_000);
});
