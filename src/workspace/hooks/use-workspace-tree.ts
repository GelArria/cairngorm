import { listDir } from "@/common/filesystem/fs-bridge";
import { useCallback, useRef, useState } from "preact/hooks";

import { entriesToNodes } from "@/workspace/model/tree-utils";
import type { FileNode } from "@/workspace/model/types";

export function useWorkspaceTree() {
  const [fsTree, setFsTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Only the latest load may write: switching A → B fast must never show A's tree under B
  const loadSeq = useRef(0);
  const loadFsTree = useCallback(async (dirPath: string | null) => {
    const seq = ++loadSeq.current;
    setLoadError(null);
    setFsTree([]);
    if (!dirPath) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const entries = await listDir(dirPath);
      if (seq === loadSeq.current) {
        setFsTree(entriesToNodes(entries));
      }
    } catch (err) {
      if (seq === loadSeq.current) {
        setLoadError(String(err));
      }
    }
    if (seq === loadSeq.current) {
      setIsLoading(false);
    }
  }, []);

  return { fsTree, setFsTree, isLoading, loadError, loadSeq, loadFsTree };
}
