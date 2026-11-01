import type { FsEntry } from "@/common/filesystem/fs-bridge";
import type { FileNode } from "@/workspace/model/types";

export function removeNodeAtPath(tree: FileNode[], path: string[]): FileNode[] {
  if (path.length === 0) {
    return tree;
  }
  const [head, ...tail] = path;
  return tree
    .map((n) => {
      if (n.name !== head) {
        return n;
      }
      if (tail.length === 0) {
        return null;
      }
      return { ...n, children: n.children ? removeNodeAtPath(n.children, tail) : n.children };
    })
    .filter(Boolean) as FileNode[];
}

export function addChildAtPath(tree: FileNode[], path: string[], child: FileNode): FileNode[] {
  if (path.length === 0) {
    return [...tree, child];
  }
  const [head, ...tail] = path;
  return tree.map((n) => {
    if (n.name !== head) {
      return n;
    }
    if (tail.length === 0) {
      return { ...n, children: [...(n.children ?? []), child] };
    }
    return { ...n, children: n.children ? addChildAtPath(n.children, tail, child) : n.children };
  });
}

export function updateChildrenAtPath(
  tree: FileNode[],
  path: string[],
  children: FileNode[],
): FileNode[] {
  if (path.length === 0) {
    return children;
  }
  const [head, ...tail] = path;
  return tree.map((n) => {
    if (n.name !== head) {
      return n;
    }
    if (tail.length === 0) {
      return { ...n, children };
    }
    return { ...n, children: updateChildrenAtPath(n.children ?? [], tail, children) };
  });
}

export function findNodeAtPath(tree: FileNode[], path: string[]): FileNode | null {
  if (path.length === 0) {
    return null;
  }
  const [head, ...tail] = path;
  const node = tree.find((n) => n.name === head);
  if (!node) {
    return null;
  }
  if (tail.length === 0) {
    return node;
  }
  return node.children ? findNodeAtPath(node.children, tail) : null;
}

export function moveNode(tree: FileNode[], fromPath: string[], toPath: string[]): FileNode[] {
  const node = findNodeAtPath(tree, fromPath);
  if (
    !node ||
    (toPath.length >= fromPath.length && fromPath.every((part, i) => toPath[i] === part))
  ) {
    return tree;
  }
  if (toPath.length && findNodeAtPath(tree, toPath)?.type !== "folder") {
    return tree;
  }
  if (findNodeAtPath(tree, [...toPath, node.name])) {
    return tree;
  }
  return addChildAtPath(removeNodeAtPath(tree, fromPath), toPath, node);
}

export function entriesToNodes(entries: FsEntry[]): FileNode[] {
  return entries
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((e) =>
      e.isDirectory
        ? { name: e.name, type: "folder" as const, children: [] }
        : { name: e.name, type: "file" as const, size: "" },
    );
}

/** Fresh directory listing, keeping the already-loaded children of folders that still exist. */
export function mergeLoaded(old: FileNode[], fresh: FileNode[]): FileNode[] {
  const byName = new Map(old.map((n) => [n.name, n]));
  return fresh.map((n) => {
    const prev = n.type === "folder" ? byName.get(n.name) : undefined;
    return prev?.type === "folder" && prev.children?.length ? { ...n, children: prev.children } : n;
  });
}
