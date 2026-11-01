export interface FileNode {
  name: string;
  type: "folder" | "file";
  size?: string;
  children?: FileNode[];
}

/** Expand / collapse / reveal request from the context menu; `id` changes on every request. */
export interface ExpandCmd {
  id: number;
  type: "collapse" | "expand" | "reveal";
  path: string[];
}
