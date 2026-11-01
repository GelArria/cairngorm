import type { ExpandCmd, FileNode } from "./types";
export interface FileActionOptions {
  rootPath: string | null;
  fsTree: FileNode[];
  setFsTree: (update: (prev: FileNode[]) => FileNode[]) => void;
  setFsError: (msg: string | null) => void;
  setSearchMode: (on: boolean) => void;
  openFile: (node: FileNode, path: string[], inSplit?: boolean) => void;
  /** Tell this panel's rows to expand / collapse / reveal. */
  expand: (cmd: Omit<ExpandCmd, "id">) => void;
}

export type FileCreation = { kind: "file" | "folder"; dir: string[]; rootAtOpen: string };
export type FileRename = { path: string[]; value: string; abs: string };

export interface FileActionDialogProps {
  creating: FileCreation | null;
  deleting: FileDeletion | null;
  setCreating: (value: FileCreation | null) => void;
  setDeleting: (value: FileDeletion | null) => void;
  validateName: (name: string) => string | undefined;
  createItem: (name: string) => void;
  deleteItem: () => void;
}

export interface FileDeletion {
  path: string[];
  node: FileNode;
  abs: string;
}
