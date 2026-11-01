import {
  clipboardImageName,
  fileToDataUrl,
  processClipboardFile,
} from "@/common/filesystem/clipboard-files";
import { isImageExtension } from "@/common/filesystem/file-kinds";
import { readFileContent } from "@/common/filesystem/fs-bridge";
import { DOCUMENT_MAX_BYTES, hasDocumentProvider } from "@/documents/api";
import type { useTerminalTabs } from "@/terminal/workspace";
import { getExtension } from "@/workspace/model/file-contents";
import { useCallback, useEffect } from "preact/hooks";

const TEXT_EXTENSIONS = new Set([
  "json",
  "md",
  "yaml",
  "yml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "py",
  "rs",
  "sql",
  "sh",
  "toml",
  "xml",
  "csv",
  "log",
  "cfg",
  "ini",
  "env",
  "gitignore",
  "editorconfig",
  "skill",
  "txt",
  "markdown",
]);

export function useExternalFiles(
  termTabs: ReturnType<typeof useTerminalTabs>,
  activateChat: () => void,
  showExplorer: () => void,
) {
  const importOsFileFromPath = useCallback(
    async (filePath: string) => {
      const name = filePath.split(/[\\/]/).pop() ?? "Untitled";
      const ext = getExtension(name);
      const extLower = ext.toLowerCase();
      const isText = TEXT_EXTENSIONS.has(extLower) || extLower === "ipynb";
      // A provider reads its own bounded snapshot; nothing is read here.
      const document = await hasDocumentProvider(extLower);
      let content = "";
      try {
        if (document) {
          // Left empty: the document pane shows it.
        } else if (isText) {
          content = await readFileContent(filePath);
        } else {
          content = `[Binary: ${name}]`;
        }
      } catch {
        content = `[Error reading: ${name}]`;
      }
      termTabs.openFileTab({
        title: name,
        path: [name],
        fullPath: filePath,
        content,
        extension: ext,
        document,
      });
    },
    [termTabs, activateChat, showExplorer],
  );

  // Files dropped or pasted arrive as content without a path on disk.
  const openDroppedFile = useCallback(
    async (file: File) => {
      const name = clipboardImageName(file);
      const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
      const image = isImageExtension(ext) || file.type.startsWith("image/");
      if (!image && file.size <= DOCUMENT_MAX_BYTES && (await hasDocumentProvider(ext))) {
        termTabs.openFileTab({
          title: name,
          path: [name],
          content: "",
          extension: ext,
          binarySrc: await fileToDataUrl(file),
          document: true,
        });
        return;
      }
      const result = await processClipboardFile(file);
      termTabs.openFileTab({
        title: result.name,
        path: [result.name],
        content: result.content,
        extension: result.ext,
        imageSrc: result.imageSrc,
      });
    },
    [termTabs],
  );

  // Handle OS file drops (from Explorer/Finder) — only intercept when Files are being dragged
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) {
        return;
      }
      e.preventDefault();
      // With dragDropEnabled: false, e.dataTransfer.files is now populated
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file) {
            continue;
          }
          await openDroppedFile(file);
        }
        activateChat();
        showExplorer();
        return;
      }
      // Fallback: use Tauri event for file paths if files array is empty
      // (happens in some Tauri WebView2 configurations)
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [termTabs, activateChat, showExplorer]);

  // Tauri-native file drop fallback: receives real file paths from Rust
  // Only fires when dragDropEnabled is true or in edge cases
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string[]>("os-file-drop", async (e) => {
          const paths = e.payload;
          for (const p of paths) {
            await importOsFileFromPath(p);
          }
          activateChat();
          showExplorer();
        });
      } catch {
        /* not running in Tauri */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [importOsFileFromPath]);

  // Paste files from clipboard — process images and text, open in editor
  useEffect(() => {
    const paste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) {
        return;
      }
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const f = items[i].getAsFile();
          if (f) {
            files.push(f);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        for (const file of files) {
          await openDroppedFile(file);
        }
        activateChat();
        showExplorer();
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [termTabs, activateChat, showExplorer]);

  return { openPath: importOsFileFromPath };
}
