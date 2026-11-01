import { useLoaderGate } from "@/common/branding/";
import { openFolderDialog } from "@/common/filesystem/fs-bridge";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { getGitState, subscribeGit } from "@/git/hooks/use-git-status";
import { setProjectRoot, useActiveProject } from "@/projects/api";
import { setGlobalSearchRootPath } from "@/search";
import { projectFileStatus } from "@/workspace/data/project-file-status";
import { useFileActions } from "@/workspace/hooks/use-file-actions";
import { useFileContents } from "@/workspace/hooks/use-file-contents";
import { useWorkspaceNavigation } from "@/workspace/hooks/use-workspace-navigation";
import { useWorkspaceTree } from "@/workspace/hooks/use-workspace-tree";
import { addChildAtPath, moveNode } from "@/workspace/model/tree-utils";
import type { ExpandCmd, FileNode } from "@/workspace/model/types";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

export function useWorkspacePanel() {
  const [fileTree, setFileTree] = useLocalStorage<FileNode[]>("workspace-files", []);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Git marks (M/A/U) for the tree — only when the open folder IS the repo root
  const [git, setGit] = useState(getGitState);
  useEffect(() => subscribeGit(() => setGit(getGitState())), []);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newName, setNewName] = useState("");
  const fileContents = useFileContents();
  const [rootPath, setRootPath] = useState<string | null>(null);
  const { fsTree, setFsTree, isLoading, loadError, loadSeq, loadFsTree } = useWorkspaceTree();
  const showTreeLoader = useLoaderGate(isLoading);
  const treeBusy = isLoading || showTreeLoader;
  const [fsError, setFsError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const cm = useContextMenu();
  const [expandCmd, setExpandCmd] = useState<ExpandCmd | null>(null);
  const expand = useCallback(
    (c: Omit<ExpandCmd, "id">) => setExpandCmd((p) => ({ ...c, id: (p?.id ?? 0) + 1 })),
    [],
  );

  // Sync rootPath to global search module (and forget expanded folders of the old root)
  useEffect(() => {
    setGlobalSearchRootPath(rootPath);
    expand({ type: "collapse", path: [] });
  }, [rootPath]);

  // The tree follows the active project's folder (switch project = switch tree)
  const project = useActiveProject();
  const projectId = project?.id ?? null;
  const projectRoot = project?.rootPath || null;
  useEffect(() => {
    setFsError(null);
    setSearchMode(false);
    setSelectedPath(null);
    setIsAddingFile(false);
    setIsAddingFolder(false);
    setNewName("");
    setRootPath(projectRoot);
    loadFsTree(projectRoot);
  }, [projectId, projectRoot, loadFsTree]);

  // "Open folder" here points the active project at another folder
  const handleOpenFolder = useCallback(async () => {
    const folder = await openFolderDialog();
    if (folder && projectId) {
      setProjectRoot(projectId, folder);
    }
  }, [projectId]);

  const commitAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      setIsAddingFolder(false);
      setIsAddingFile(false);
      return;
    }
    const targetPath: string[] = [];
    const child: FileNode = isAddingFolder
      ? { name, type: "folder", children: [] }
      : { name, type: "file", size: "new" };
    setFileTree((prev) => addChildAtPath(prev, targetPath, child));
    if (!isAddingFolder) {
      fileContents.setContent([...targetPath, name], "");
    }
    setNewName("");
    setIsAddingFolder(false);
    setIsAddingFile(false);
  }, [newName, isAddingFolder, setFileTree, fileContents]);

  const handleAddKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        commitAdd();
      }
      if (e.key === "Escape") {
        setIsAddingFolder(false);
        setIsAddingFile(false);
        setNewName("");
      }
    },
    [commitAdd],
  );

  const { openFileNode, handleClickFile, openSearchMatch } = useWorkspaceNavigation({
    rootPath,
    fileContents,
    loadSeq,
    setSelectedPath,
    setFsTree,
    setFsError,
  });

  const fileActions = useFileActions({
    rootPath,
    fsTree,
    setFsTree,
    setFsError,
    setSearchMode,
    openFile: openFileNode,
    expand,
  });
  const { renaming, setRenaming, commitRename } = fileActions;
  const handleMoveNode = (from: string[], to: string[]) => {
    if (rootPath) {
      return fileActions.moveInto(from, to);
    }
    const next = moveNode(fileTree, from, to);
    if (next === fileTree) {
      return;
    }
    fileContents.moveContent(from, [...to, from[from.length - 1]]);
    setFileTree(next);
  };

  const displayTree = rootPath ? fsTree : fileTree;

  const { sameRoot, gitCodes, gitCodeOf } = useMemo(
    () => projectFileStatus(git, rootPath),
    [git, rootPath],
  );
  return {
    selectedPath,
    git,
    isAddingFolder,
    setIsAddingFolder,
    isAddingFile,
    setIsAddingFile,
    newName,
    setNewName,
    rootPath,
    loadError,
    loadFsTree,
    showTreeLoader,
    treeBusy,
    fsError,
    setFsError,
    searchMode,
    setSearchMode,
    cm,
    expandCmd,
    projectId,
    handleOpenFolder,
    handleAddKeyDown,
    handleClickFile,
    openSearchMatch,
    fileActions,
    renaming,
    setRenaming,
    commitRename,
    handleMoveNode,
    displayTree,
    sameRoot,
    gitCodes,
    gitCodeOf,
  };
}
