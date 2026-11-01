// Open workspace files as panes in the unified terminal/file grid.
import { isImageExtension } from "@/common/filesystem/file-kinds";
import { readFileAsDataURL, readFileContent } from "@/common/filesystem/fs-bridge";
import { hasDocumentProvider } from "@/documents/api";
import { getExtension } from "@/workspace/model/file-contents";

export interface OpenFileDetail {
  title: string;
  path: string[];
  fullPath?: string;
  content: string;
  extension: string;
  openInSplit?: boolean;
  imageSrc?: string;
  binarySrc?: string;
  /** Shown by a document provider; the pane reads its own bounded snapshot. */
  document?: boolean;
  line?: number;
  highlightText?: string;
}

/** Open a file as a grid pane (App owns the tab store and brings the grid forward). */
export function openInEditor(detail: OpenFileDetail) {
  window.dispatchEvent(new CustomEvent("editor-open-file", { detail }));
}

/** Read a file from disk (data URL for images, text otherwise) and open it. */
export async function openDiskFile(
  title: string,
  path: string[],
  fullPath: string,
  openInSplit = false,
) {
  const extension = getExtension(title);
  if (isImageExtension(extension)) {
    openInEditor({
      title,
      path,
      fullPath,
      content: "",
      extension,
      imageSrc: await readFileAsDataURL(fullPath),
      openInSplit,
    });
  } else if (await hasDocumentProvider(extension)) {
    openInEditor({ title, path, fullPath, content: "", extension, document: true, openInSplit });
  } else {
    openInEditor({
      title,
      path,
      fullPath,
      content: await readFileContent(fullPath),
      extension,
      openInSplit,
    });
  }
}
