import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/preact";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

let store: typeof import("../../src/terminal/hooks/use-terminal-tabs");
beforeEach(async () => {
  vi.resetModules();
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
});
afterEach(cleanup);

describe("terminal store render isolation", () => {
  it("keeps app/sidebar chrome out of content-only updates while the editor stays current", () => {
    let chromeRenders = 0,
      sidebarRenders = 0;
    const chrome = renderHook(() => {
      chromeRenders++;
      return store.useTerminalTabs({ content: false });
    });
    const sidebar = renderHook(() => {
      sidebarRenders++;
      return store.useTerminalGroups();
    });
    const editor = renderHook(() => store.useTerminalTabs());
    let id = "";
    act(() => {
      id = editor.result.current.openFileTab({
        title: "a.txt",
        path: ["a.txt"],
        fullPath: "C:/a.txt",
        content: "",
      });
    });
    act(() => editor.result.current.updateFileContent(id, "first edit")); // dirty flag must still reach chrome
    expect(chrome.result.current.activeTab?.isDirty).toBe(true);
    const before = { chrome: chromeRenders, sidebar: sidebarRenders };
    // Separate renders, as real keystrokes: batching all 100 in one act would hide the problem.
    for (let i = 0; i < 100; i++)
      act(() => editor.result.current.updateFileContent(id, `edit-${i}`));
    console.log(
      `100 edits: app chrome ${chromeRenders - before.chrome}, sidebar ${sidebarRenders - before.sidebar} renders`,
    );
    expect(chromeRenders).toBe(before.chrome);
    expect(sidebarRenders).toBe(before.sidebar);
    expect(editor.result.current.activeTab?.content).toBe("edit-99");
    expect(store.getTerminalTab(id)?.content).toBe("edit-99"); // saving must read the latest store, not chrome's old snapshot
    act(() => editor.result.current.markFileClean(id));
    expect(chrome.result.current.activeTab?.isDirty).toBe(false);
    expect(sidebar.result.current.tabs[0].isDirty).toBe(false);
  });

  it("still delivers rename, status, layout, group and active-tab changes to chrome", () => {
    const chrome = renderHook(() => store.useTerminalTabs({ content: false }));
    const editor = renderHook(() => store.useTerminalTabs());
    act(() => editor.result.current.openTab({ profile: "code-assistant", title: "A" }));
    const a = editor.result.current.activeTab!.id;
    act(() => editor.result.current.openTab({ profile: "code-assistant", title: "B" }));
    const b = editor.result.current.activeTab!.id;
    act(() => editor.result.current.renameTab(a, "renamed"));
    expect(chrome.result.current.state.tabs[0].title).toBe("renamed");
    act(() => editor.result.current.updateTabStatus(a, "idle"));
    expect(chrome.result.current.state.tabs[0].status).toBe("idle");
    act(() => editor.result.current.setActiveTab(a));
    expect(chrome.result.current.activeTab?.id).toBe(a);
    act(() => editor.result.current.dockTab(b, a, "right"));
    expect(chrome.result.current.state.layout?.cells).toHaveLength(2);
    act(() => store.syncProjectGroups([{ id: "p", name: "Project", cwd: "C:/project" }], "p"));
    expect(chrome.result.current.state.activeGroupId).toBe("p");
    expect(chrome.result.current.state.groups[0].cwd).toBe("C:/project");
  });

  it("catches up to current content when a subscriber opts back into document updates", () => {
    const chrome = renderHook(({ content }) => store.useTerminalTabs({ content }), {
      initialProps: { content: false },
    });
    const editor = renderHook(() => store.useTerminalTabs());
    let id = "";
    act(() => {
      id = editor.result.current.openFileTab({
        title: "a.txt",
        path: ["a.txt"],
        content: "original",
      });
    });
    act(() => editor.result.current.updateFileContent(id, "first"));
    act(() => editor.result.current.updateFileContent(id, "latest"));
    expect(chrome.result.current.activeTab?.content).toBe("first");
    act(() => chrome.rerender({ content: true }));
    expect(chrome.result.current.activeTab?.content).toBe("latest");
  });

  it("does not broadcast a store mutation that returns the same state", () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders++;
      return store.useTerminalTabs();
    });
    const before = renders;
    act(() => hook.result.current.dissolveSplit());
    expect(renders).toBe(before);
  });
});
