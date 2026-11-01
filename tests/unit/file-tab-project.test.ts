import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/common/filesystem/fs-bridge", () => ({ writeFileContent: vi.fn() }));
vi.mock("@/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

let actions: typeof import("@/terminal/state/file-actions");
let store: typeof import("@/terminal/state/terminal-store");

beforeEach(async () => {
  vi.resetModules();
  actions = await import("@/terminal/state/file-actions");
  store = await import("@/terminal/state/terminal-store");
  store.setState((prev) => ({
    ...prev,
    groups: [
      { id: "g1", name: "Active" },
      { id: "g2", name: "Background" },
    ],
  }));
});

it("adds an agent document to its own inactive project without changing the view", () => {
  const shown = actions.openFileTab({
    title: "a.md",
    path: ["a.md"],
    fullPath: "C:/a.md",
    content: "a",
  });
  const before = store.currentState;
  const id = actions.openFileTab({
    title: "Review.docx",
    path: ["Review.docx"],
    fullPath: "C:/B/Review.docx",
    document: true,
    ticket: "t1",
    groupId: "g2",
  });
  const after = store.currentState;
  expect(after.activeTabId).toBe(shown);
  expect(after.layout).toBe(before.layout);
  expect(store.getTerminalTab(id)).toMatchObject({
    groupId: "g2",
    documentTicket: "t1",
    document: {},
  });
});

it("reuses the project's tab for the same file and swaps in the newer snapshot", () => {
  const first = actions.openFileTab({
    title: "r.docx",
    path: ["r.docx"],
    fullPath: "C:/r.docx",
    document: true,
    ticket: "old",
    groupId: "g2",
  });
  const other = actions.openFileTab({
    title: "r.docx",
    path: ["r.docx"],
    fullPath: "C:/r.docx",
    content: "",
    groupId: "g1",
  });
  const again = actions.openFileTab({
    title: "r.docx",
    path: ["r.docx"],
    fullPath: "C:/r.docx",
    document: true,
    ticket: "new",
    groupId: "g2",
  });
  expect(again).toBe(first);
  expect(other).not.toBe(first);
  expect(store.getTerminalTab(first)?.documentTicket).toBe("new");
});
