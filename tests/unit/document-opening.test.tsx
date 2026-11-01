// Every entry point routes by provider declarations; no consumer names a format.
import { cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  readFileAsDataURL: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/common/filesystem/fs-bridge", () => io);
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@/terminal/state/file-actions", async (load) => ({
  ...(await load<typeof import("@/terminal/state/file-actions")>()),
  saveFileTab: vi.fn(),
}));

import { processClipboardFile } from "@/common/filesystem/clipboard-files";
import { reloadProviders } from "@/documents/data/provider-registry";
import { useFilePane } from "@/terminal/hooks/use-file-pane";
import type { TermTab } from "@/terminal/model/types";
import { openDiskFile } from "@/workspace/data/open-file";

const sampleRow = {
  id: "dev.cairngorm.sample-viewer",
  error: null,
  manifest: {
    id: "dev.cairngorm.sample-viewer",
    name: "Sample viewer",
    version: "1.0.0",
    fileTypes: [{ label: "Sample", extensions: ["sample"], mimeTypes: [] }],
    capabilities: ["view"],
    maxBytes: 1024,
  },
};

async function opened(title: string) {
  const listener = vi.fn();
  window.addEventListener("editor-open-file", listener);
  try {
    await openDiskFile(title, [title], `C:/A B/${title}`, true);
  } finally {
    window.removeEventListener("editor-open-file", listener);
  }
  return listener.mock.calls[0][0].detail;
}

beforeEach(async () => {
  vi.resetAllMocks();
  native.invoke.mockImplementation(async (cmd: string) =>
    cmd === "document_providers_list" ? [sampleRow] : null,
  );
  io.readFileContent.mockResolvedValue("text");
  await reloadProviders();
});
afterEach(cleanup);

it.each(["Review.final.DOCX", "q3.xlsx", "report.pdf", "data.csv", "notes.sample"])(
  "opens %s as a document without reading it",
  async (title) => {
    expect(await opened(title)).toMatchObject({ document: true, content: "", openInSplit: true });
    expect(io.readFileContent).not.toHaveBeenCalled();
    expect(io.readFileAsDataURL).not.toHaveBeenCalled();
  },
);

it.each(["legacy.doc", "macro.docm", "main.ts"])("keeps %s in the text editor", async (title) => {
  const detail = await opened(title);
  expect(detail.document).toBeUndefined();
  expect(detail.content).toBe("text");
});

it("stops routing a provider's extension once it is removed", async () => {
  native.invoke.mockResolvedValue([]);
  await reloadProviders();
  expect((await opened("notes.sample")).document).toBeUndefined();
});

it("restores document panes saved without the document flag", () => {
  const tab = (patch: Partial<TermTab>) =>
    ({
      id: "t",
      title: "review.docx",
      extension: "docx",
      fullPath: "C:/review.docx",
      ...patch,
    }) as TermTab;
  expect(renderHook(() => useFilePane({ tab: tab({}) })).result.current.isDocument).toBe(true);
  expect(
    renderHook(() => useFilePane({ tab: tab({ content: "edited", isDirty: true }) })).result.current
      .isDocument,
  ).toBe(false);
  expect(
    renderHook(() => useFilePane({ tab: tab({ extension: "ts", title: "a.ts" }) })).result.current
      .isDocument,
  ).toBe(false);
  expect(
    renderHook(() => useFilePane({ tab: tab({ extension: "zzz", document: {} }) })).result.current
      .isDocument,
  ).toBe(true);
});

it("handles multi-dot uppercase filenames from clipboard and browser drops", async () => {
  const result = await processClipboardFile(
    new File(["# x"], "Notes.final.MD", { type: "text/markdown" }),
  );
  expect(result.ext).toBe("md");
  expect(result.content).toBe("# x");
});
