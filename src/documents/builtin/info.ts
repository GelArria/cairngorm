// Providers that ship with Cairngorm. They satisfy the same contract as installed ones;
// their views run in-process because they are first-party code, not because they are special.
import type { DocumentProviderInfo } from "../model/provider";

const MiB = 1024 * 1024;

export const BUILTIN_PROVIDERS: DocumentProviderInfo[] = [
  {
    id: "cairngorm.docx-preview",
    name: "Word document preview",
    version: "1.0.0",
    description: "Read-only DOCX rendering. Works without Microsoft Word.",
    fileTypes: [
      {
        label: "DOCX document",
        extensions: ["docx"],
        mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      },
    ],
    capabilities: ["view"],
    maxBytes: 25 * MiB,
    source: "builtin",
  },
  {
    id: "cairngorm.spreadsheet-preview",
    name: "Spreadsheet preview",
    version: "1.0.0",
    description: "First worksheet of XLSX workbooks and delimited text tables.",
    fileTypes: [
      {
        label: "Workbook",
        extensions: ["xlsx", "xls"],
        mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      },
      { label: "CSV table", extensions: ["csv"], mimeTypes: ["text/csv"] },
      { label: "TSV table", extensions: ["tsv"], mimeTypes: ["text/tab-separated-values"] },
    ],
    capabilities: ["view"],
    maxBytes: 25 * MiB,
    source: "builtin",
  },
  {
    id: "cairngorm.pdf-viewer",
    name: "PDF viewer",
    version: "1.0.0",
    description: "The webview's built-in PDF viewer.",
    fileTypes: [{ label: "PDF document", extensions: ["pdf"], mimeTypes: ["application/pdf"] }],
    capabilities: ["view"],
    maxBytes: 32 * MiB,
    source: "builtin",
  },
];
