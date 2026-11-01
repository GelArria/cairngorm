import { describe, expect, it } from "vitest";
import { delimitedRows, PREVIEW_MAX_ROWS } from "@/editor/file-preview";
import { NOTEBOOK_EXTENSIONS, TEXT_EXTENSIONS } from "@/common/filesystem/file-kinds";
import { BUILTIN_PROVIDERS } from "@/documents/builtin/info";
import { providersFor } from "@/documents/model/provider-match";

describe("file preview routing", () => {
  it("routes PDF, workbooks and tables to built-in document providers", () => {
    for (const extension of ["pdf", "xlsx", "xls", "csv", "tsv", "docx"]) {
      expect(providersFor(BUILTIN_PROVIDERS, extension)).toHaveLength(1);
    }
  });

  it("recognizes notebook and lightweight text formats", () => {
    expect(NOTEBOOK_EXTENSIONS.has("ipynb")).toBe(true);
    expect(TEXT_EXTENSIONS.has("md")).toBe(true);
  });

  it("parses quoted CSV cells without synthetic columns", () => {
    expect(delimitedRows('Name,Count\n"alpha, one",3')).toEqual([
      ["Name", "Count"],
      ["alpha, one", "3"],
    ]);
    expect(delimitedRows("Name\tCount\nalpha\t3", "\t")).toEqual([
      ["Name", "Count"],
      ["alpha", "3"],
    ]);
  });

  it("bounds large delimited previews", () => {
    const content = Array.from({ length: PREVIEW_MAX_ROWS + 200 }, (_, i) => `${i},value`).join(
      "\n",
    );
    expect(delimitedRows(content)).toHaveLength(PREVIEW_MAX_ROWS);
  });
});
