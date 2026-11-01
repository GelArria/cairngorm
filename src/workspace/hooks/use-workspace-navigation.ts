import { listDir, readFileContent, type SearchMatch } from "@/common/filesystem/fs-bridge";
import { joinPath } from "@/common/filesystem/fs-ops";
import { useCallback } from "preact/hooks";

import { openDiskFile, openInEditor } from "@/workspace/data/open-file";
import { useFileContents } from "@/workspace/hooks/use-file-contents";
import { getExtension } from "@/workspace/model/file-contents";
import {
  entriesToNodes,
  findNodeAtPath,
  mergeLoaded,
  updateChildrenAtPath,
} from "@/workspace/model/tree-utils";
import type { FileNode } from "@/workspace/model/types";

import type { RefObject } from "preact";
interface WorkspaceNavigationOptions {
  rootPath: string | null;
  fileContents: ReturnType<typeof useFileContents>;
  loadSeq: RefObject<number>;
  setSelectedPath: (path: string | null) => void;
  setFsTree: (update: (tree: FileNode[]) => FileNode[]) => void;
  setFsError: (error: string | null) => void;
}
export function useWorkspaceNavigation({
  rootPath,
  fileContents,
  loadSeq,
  setSelectedPath,
  setFsTree,
  setFsError,
}: WorkspaceNavigationOptions) {
  /** A file of the tree as a grid pane: from disk when a folder is open, else the local scratch tree. */
  const openFileNode = useCallback(
    async (node: FileNode, path: string[], inSplit = false) => {
      if (node.type !== "file") {
        return;
      }
      if (!inSplit) {
        setSelectedPath(path.join("/"));
      }
      try {
        if (rootPath) {
          await openDiskFile(node.name, path, joinPath(rootPath, ...path), inSplit);
        } else {
          openInEditor({
            title: node.name,
            path,
            content: fileContents.getContent(path),
            extension: getExtension(node.name),
            openInSplit: inSplit,
          });
        }
      } catch (err) {
        setFsError(String(err));
      }
    },
    [rootPath, fileContents],
  );

  const handleClickFile = useCallback(
    async (node: FileNode, path: string[]) => {
      if (node.type === "file") {
        openFileNode(node, path);
        return;
      }
      if (!rootPath) {
        return;
      }
      const seq = loadSeq.current;
      try {
        const entries = await listDir(joinPath(rootPath, ...path));
        if (seq === loadSeq.current) {
          setFsTree((prev) =>
            updateChildrenAtPath(
              prev,
              path,
              mergeLoaded(findNodeAtPath(prev, path)?.children ?? [], entriesToNodes(entries)),
            ),
          );
        }
      } catch (err) {
        if (seq === loadSeq.current) {
          setFsError(String(err));
        }
      }
    },
    [rootPath, openFileNode],
  );

  const openSearchMatch = useCallback(async (m: SearchMatch, query: string) => {
    const name = m.path.split(/[\\/]/).pop() ?? "Untitled";
    const seq = loadSeq.current;
    try {
      const content = await readFileContent(m.path);
      if (seq !== loadSeq.current) {
        return;
      }
      setFsError(null);
      openInEditor({
        title: name,
        path: [name],
        fullPath: m.path,
        content,
        extension: getExtension(name),
        line: m.line,
        highlightText: query,
      });
    } catch (err) {
      if (seq === loadSeq.current) {
        setFsError(`Could not open ${name}: ${String(err)}`);
      }
    }
  }, []);

  return { openFileNode, handleClickFile, openSearchMatch };
}
