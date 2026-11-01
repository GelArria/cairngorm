import { APP_OPEN_FILE, onAppEvent } from "@/common/events/app-events";
import { openFilesDialog, openFolderDialog, readFileContent } from "@/common/filesystem/fs-bridge";
import { hasDocumentProvider } from "@/documents/api";
import type { useTerminalTabs } from "@/terminal/workspace";
import { saveFileTab } from "@/terminal/workspace";
import type { OpenFileDetail } from "@/workspace/data/open-file";
import { getExtension } from "@/workspace/model/file-contents";
import { useCallback, useLayoutEffect } from "preact/hooks";
import { openProjectFolder } from "../project-actions";
import { useAgentDocumentOpen } from "./use-agent-document-open";
import { useExternalFiles } from "./use-external-files";
import { useLaunchRequests } from "./use-launch-requests";

export function useAppFileActions(
  termTabs: ReturnType<typeof useTerminalTabs>,
  activateChat: () => void,
  showExplorer: () => void,
) {
  const handleOpenFile = useCallback(async () => {
    const paths = await openFilesDialog();
    if (!paths || paths.length === 0) {
      return;
    }
    const path = paths[0];
    try {
      const name = path.split(/[\\/]/).pop() ?? "Untitled";
      const extension = getExtension(name);
      const document = await hasDocumentProvider(extension);
      termTabs.openFileTab({
        title: name,
        path: [name],
        fullPath: path,
        content: document ? "" : await readFileContent(path),
        extension,
        document,
      });
      activateChat();
      showExplorer();
    } catch {
      /* permission denied or file not found */
    }
  }, [termTabs, activateChat, showExplorer]);

  // "Open File…" from the terminal area's menus
  useLayoutEffect(
    () =>
      onAppEvent(APP_OPEN_FILE, () => {
        void handleOpenFile();
      }),
    [handleOpenFile],
  );

  // Open Folder = open it as a project (reuses the project already on that folder)
  const handleOpenFolder = useCallback(async () => {
    const folder = await openFolderDialog();
    if (!folder) {
      return;
    }
    openProjectFolder(folder);
    showExplorer();
    activateChat();
  }, [activateChat, showExplorer]);

  const handleNewFile = useCallback(() => {
    termTabs.openFileTab({ title: "Untitled", path: ["Untitled"], content: "", extension: "" });
    activateChat();
    showExplorer();
  }, [termTabs, activateChat, showExplorer]);

  // Workspace files open directly in the unified terminal/file tab store.
  useLayoutEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<OpenFileDetail>).detail;
      if (!d) {
        return;
      }
      const id = termTabs.openFileTab({
        title: d.title,
        path: d.path,
        fullPath: d.fullPath,
        content: d.content ?? "",
        extension: d.extension ?? "",
        imageSrc: d.imageSrc,
        binarySrc: d.binarySrc,
        document: d.document,
        highlightLine: d.line,
        highlightText: d.highlightText,
      });
      if (d.openInSplit && !termTabs.state.layout) {
        termTabs.splitTab(id, "vertical");
      }
      // Same unified tab/grid store as terminals — switching views is safe
      activateChat();
    };
    window.addEventListener("editor-open-file", handler);
    return () => window.removeEventListener("editor-open-file", handler);
  }, [termTabs, activateChat, showExplorer]);

  const handleSaveFile = () => saveFileTab();

  const { openPath } = useExternalFiles(termTabs, activateChat, showExplorer);
  useLaunchRequests(openPath, activateChat);
  useAgentDocumentOpen(termTabs);
  return { handleOpenFile, handleOpenFolder, handleNewFile, handleSaveFile };
}
