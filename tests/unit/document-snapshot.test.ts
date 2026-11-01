import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

import { contentVersion, decodeDataUrl, readSnapshot } from "@/documents/data/document-snapshot";

beforeEach(() => native.invoke.mockReset());

it("decodes supplied content and refuses it above the provider limit", () => {
  expect(Array.from(decodeDataUrl("data:application/zip;base64,UEsDBAD/", 10))).toEqual([
    0x50, 0x4b, 3, 4, 0, 255,
  ]);
  expect(() => decodeDataUrl("data:application/zip;base64,UEsDBAD/", 4)).toThrow("too large");
  expect(() => decodeDataUrl("not a data url", 10)).toThrow();
});

it("reads files natively with the provider's limit and versions the bytes", async () => {
  native.invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  const snapshot = await readSnapshot({
    name: "a.sample",
    extension: "sample",
    mimeType: "text/plain",
    maxBytes: 1024,
    path: "C:/Project With Spaces/a.sample",
  });
  expect(native.invoke).toHaveBeenCalledWith("document_read_snapshot", {
    path: "C:/Project With Spaces/a.sample",
    maxBytes: 1024,
  });
  expect(Array.from(snapshot.bytes)).toEqual([1, 2, 3]);
  expect(snapshot.version).toBe(await contentVersion(new Uint8Array([1, 2, 3])));
  expect(snapshot.version).not.toBe(await contentVersion(new Uint8Array([1, 2, 4])));
});

it("never reads from disk when content was supplied", async () => {
  await readSnapshot({
    name: "dropped.docx",
    extension: "docx",
    mimeType: "application/octet-stream",
    maxBytes: 10,
    path: "C:/private.docx",
    dataUrl: "data:application/zip;base64,eA==",
  });
  expect(native.invoke).not.toHaveBeenCalled();
});
