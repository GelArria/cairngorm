import { expect, it } from "vitest";
import { BUILTIN_PROVIDERS } from "@/documents/builtin/info";
import type { DocumentProviderInfo } from "@/documents/model/provider";
import {
  normalizeExtension,
  providersFor,
  resolveProvider,
} from "@/documents/model/provider-match";

const installed = (id: string, name: string, extensions: string[]): DocumentProviderInfo => ({
  id,
  name,
  version: "1.0.0",
  fileTypes: [{ label: name, extensions, mimeTypes: [] }],
  capabilities: ["view"],
  maxBytes: 1024,
  source: "installed",
});

const docxAlt = installed("com.example.docx", "Alt Word viewer", ["docx"]);
const sample = installed("dev.cairngorm.sample-viewer", "Sample viewer", ["sample"]);
const all = [...BUILTIN_PROVIDERS, sample, docxAlt];

it.each(["DOCX", ".docx", " docx "])("normalizes %s", (extension) => {
  expect(normalizeExtension(extension)).toBe("docx");
});

it("matches declared extensions only, never similar formats", () => {
  expect(providersFor(all, "sample").map((p) => p.id)).toEqual([sample.id]);
  for (const extension of ["doc", "docm", "dotm", "", "unknown"]) {
    expect(providersFor(all, extension)).toEqual([]);
  }
});

it("orders candidates deterministically with built-ins first", () => {
  expect(providersFor([docxAlt, ...BUILTIN_PROVIDERS], "docx").map((p) => p.id)).toEqual([
    "cairngorm.docx-preview",
    docxAlt.id,
  ]);
});

it("asks when several providers match and nothing was chosen", () => {
  const candidates = providersFor(all, "docx");
  expect(resolveProvider(candidates, {}).kind).toBe("choose");
  expect(resolveProvider(candidates, { remembered: docxAlt.id })).toMatchObject({
    provider: docxAlt,
  });
  // A pane's explicit choice wins over the remembered one.
  expect(
    resolveProvider(candidates, { explicit: "cairngorm.docx-preview", remembered: docxAlt.id }),
  ).toMatchObject({
    provider: { id: "cairngorm.docx-preview" },
  });
});

it("ignores stale choices for uninstalled providers", () => {
  const candidates = providersFor(BUILTIN_PROVIDERS, "docx");
  expect(resolveProvider(candidates, { remembered: "com.example.gone" })).toMatchObject({
    provider: { id: "cairngorm.docx-preview" },
  });
  expect(resolveProvider([], { explicit: "x" })).toEqual({ kind: "none" });
});

it("opens with the editor included with Cairngorm unless the user chose otherwise", () => {
  const editor = installed("app.cairngorm.spreadsheet", "Spreadsheet editor", ["xlsx"]);
  const candidates = providersFor([...BUILTIN_PROVIDERS, editor], "xlsx");
  expect(candidates.length).toBeGreaterThan(1);
  expect(resolveProvider(candidates, {})).toMatchObject({ kind: "provider", provider: editor });
  const preview = candidates.find((p) => p.source === "builtin")!;
  expect(resolveProvider(candidates, { remembered: preview.id })).toMatchObject({
    provider: preview,
  });
});
