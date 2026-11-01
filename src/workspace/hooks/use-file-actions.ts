import type { FileActionOptions, FileCreation, FileRename } from "../model/file-action-types";
import {
  escapeRegExp,
  isWithinPath,
  normalizePath,
  normalizeSlashes,
} from "../model/workspace-paths";
// What the file-tree menu items DO, on the real disk (Rust fs_ops / git_ops).
// The panel owns the tree state; this hook owns the operations, the rename /
// new-item / delete dialogs and the cut-copy clipboard.
import { exists, listDir } from "@/common/filesystem/fs-bridge";
import * as ops from "@/common/filesystem/fs-ops";
import { baseName, copyName, dirName, joinPath, nameProblem } from "@/common/filesystem/fs-ops";
import { getGitState, refreshGit } from "@/git/hooks/use-git-status";
import { openGlobalSearch, setGlobalSearchIncludePattern } from "@/search/hooks/use-global-search";
import { useEffect, useRef, useState } from "preact/hooks";
import { openTerminalAt } from "../../terminal/workspace";
import { buildFileMenu, type FileActions } from "../model/file-menu";
import {
  entriesToNodes,
  findNodeAtPath,
  mergeLoaded,
  updateChildrenAtPath,
} from "../model/tree-utils";
import type { FileNode } from "../model/types";

// Cut / copy survive tree re-renders and root changes (module scope, like the OS clipboard)
let clip: { paths: string[]; cut: boolean } | null = null;

export function useFileActions(options: FileActionOptions) {
  const { rootPath, fsTree, setFsTree, setFsError, setSearchMode, openFile, expand } = options;
  const [renaming, setRenaming] = useState<FileRename | null>(null);
  const [creating, setCreating] = useState<FileCreation | null>(null);
  // absolute path captured when the dialog opens: a root change meanwhile must not retarget it
  const [deleting, setDeleting] = useState<{ path: string[]; node: FileNode; abs: string } | null>(
    null,
  );

  const abs = (path: string[]) => joinPath(rootPath ?? "", ...path);
  const fail = (e: unknown) => setFsError(String((e as Error)?.message ?? e));
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
  };
  /** Tree path of an absolute path inside the open folder (null when outside). */
  const relOf = (p: string): string[] | null => {
    const root = normalizeSlashes(rootPath ?? ""),
      q = normalizeSlashes(p);
    if (!root || !isWithinPath(normalizePath(q), normalizePath(root))) {
      return null;
    }
    return q.slice(root.length).split("/").filter(Boolean);
  };

  // The tree can be mounted twice (sidebar + right panel, possibly on different
  // folders): tell the other one too, with the root so it can ignore foreign events.
  const self = useRef(Math.random());
  const list = async (dir: string[]) => {
    const nodes = entriesToNodes(await listDir(abs(dir)));
    setFsTree((prev) =>
      dir.length === 0
        ? mergeLoaded(prev, nodes)
        : updateChildrenAtPath(
            prev,
            dir,
            mergeLoaded(findNodeAtPath(prev, dir)?.children ?? [], nodes),
          ),
    );
  };
  const refreshDir = async (dir: string[]) => {
    await list(dir);
    window.dispatchEvent(
      new CustomEvent("workspace-fs-changed", {
        detail: { from: self.current, root: rootPath, dir },
      }),
    );
  };
  useEffect(() => {
    const on = (e: Event) => {
      const { from, root, dir } = (e as CustomEvent<{ from: number; root: string; dir: string[] }>)
        .detail;
      if (
        from !== self.current &&
        rootPath &&
        normalizePath(root ?? "") === normalizePath(rootPath)
      ) {
        list(dir).catch(() => {});
      }
    };
    window.addEventListener("workspace-fs-changed", on);
    return () => window.removeEventListener("workspace-fs-changed", on);
  });
  const refreshAbs = async (p: string) => {
    const r = relOf(p);
    if (r) {
      await refreshDir(r);
    }
  };

  /** "name copy.ext" … first one not taken in `dir` on disk. */
  const dupName = async (dir: string, name: string) => {
    const taken = new Set<string>();
    for (let i = 0; i < 99; i++) {
      const c = copyName(name, (x) => taken.has(x));
      if (!(await exists(joinPath(dir, c)))) {
        return c;
      }
      taken.add(c);
    }
    return copyName(name, () => false);
  };

  const paste = (dir: string[]) =>
    run(async () => {
      if (!clip) {
        return;
      }
      const { paths, cut } = clip;
      const target = abs(dir);
      for (const src of paths) {
        const name = baseName(src);
        if (cut) {
          if (normalizePath(dirName(src)) === normalizePath(target)) {
            continue;
          }
          await ops.renamePath(src, joinPath(target, name));
          await refreshAbs(dirName(src));
        } else {
          const dest = (await exists(joinPath(target, name)))
            ? joinPath(target, await dupName(target, name))
            : joinPath(target, name);
          await ops.copyPath(src, dest);
        }
      }
      if (cut) {
        clip = null;
      }
      expand({ type: "reveal", path: dir });
      await refreshDir(dir);
    });

  const actionsFor = (path: string[], node: FileNode | null): FileActions => {
    const isFile = node?.type === "file";
    const dir = node ? (isFile ? path.slice(0, -1) : path) : [];
    const here = node ? abs(path) : (rootPath ?? "");
    return {
      open: () => node && openFile(node, path),
      openInSplit: () => node && openFile(node, path, true),
      newFile: () => setCreating({ kind: "file", dir, rootAtOpen: rootPath ?? "" }),
      newFolder: () => setCreating({ kind: "folder", dir, rootAtOpen: rootPath ?? "" }),
      reveal: () => void run(() => ops.revealPath(here)),
      openDefault: () => void run(() => ops.openDefault(here)),
      openTerminal: () => {
        openTerminalAt(abs(dir));
        window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));
      },
      findInFolder: () => {
        const parts = abs(dir)
          .split(/[\\/]+/)
          .filter(Boolean)
          .map(escapeRegExp);
        setSearchMode(true);
        openGlobalSearch();
        setGlobalSearchIncludePattern(parts.join("[\\\\/]") + "[\\\\/]");
      },
      cut: () => {
        clip = { paths: [here], cut: true };
      },
      copy: () => {
        clip = { paths: [here], cut: false };
      },
      duplicate: () =>
        void run(async () => {
          const parent = dirName(here);
          await ops.copyPath(here, joinPath(parent, await dupName(parent, baseName(here))));
          await refreshAbs(parent);
        }),
      paste: () => void paste(dir),
      copyPath: () => void navigator.clipboard?.writeText(here)?.catch(() => {}),
      copyRelativePath: () => void navigator.clipboard?.writeText(path.join("/"))?.catch(() => {}),
      ignore: (local) =>
        void run(async () => {
          await ops.gitIgnore(rootPath ?? "", here, local);
          await refreshGit(true);
        }),
      rename: () => node && setRenaming({ path, value: node.name, abs: here }),
      remove: () => node && setDeleting({ path, node, abs: here }),
      expandAll: () => expand({ type: "expand", path }),
      collapseAll: () => expand({ type: "collapse", path: [] }),
    };
  };

  const menuFor = (path: string[], node: FileNode | null) => {
    const g = getGitState();
    const inRepo =
      !!g.repo &&
      !!g.repoRoot &&
      isWithinPath(normalizePath(rootPath ?? ""), normalizePath(g.repoRoot));
    return buildFileMenu(
      { kind: node ? node.type : "root", onDisk: !!rootPath, inRepo, canPaste: !!clip },
      actionsFor(path, node),
    );
  };

  const commitRename = () => {
    const r = renaming;
    setRenaming(null);
    if (!r || !rootPath) {
      return;
    }
    const name = r.value.trim();
    if (!name || name === baseName(r.abs)) {
      return;
    }
    const problem = nameProblem(name);
    if (problem) {
      return fail(problem);
    }
    void run(async () => {
      await ops.renamePath(r.abs, joinPath(dirName(r.abs), name));
      await refreshAbs(dirName(r.abs));
    });
  };

  /** Drag a row onto a folder (real move). */
  const moveInto = (from: string[], to: string[]) => {
    const f = from.join("/").toLowerCase(),
      t = to.join("/").toLowerCase();
    if (!rootPath || from.length === 0 || t === f || t.startsWith(f + "/")) {
      return;
    }
    const name = from[from.length - 1];
    void run(async () => {
      await ops.renamePath(abs(from), joinPath(abs(to), name));
      expand({ type: "reveal", path: to });
      await refreshDir(from.slice(0, -1));
      await refreshDir(to);
    });
  };

  const siblings = (dir: string[]) =>
    (dir.length ? findNodeAtPath(fsTree, dir)?.children : fsTree) ?? [];

  const validateName = (name: string) =>
    nameProblem(name) ??
    (siblings(creating?.dir ?? []).some((node) => node.name.toLowerCase() === name.toLowerCase())
      ? `"${name}" already exists`
      : undefined);
  const createItem = (name: string) => {
    const captured = creating;
    setCreating(null);
    if (!captured || normalizePath(captured.rootAtOpen) !== normalizePath(rootPath ?? "")) {
      return; // A root change must not retarget a pending creation.
    }
    void run(async () => {
      const full = joinPath(abs(captured.dir), name);
      await (captured.kind === "folder" ? ops.createDir(full) : ops.createFile(full));
      expand({ type: "reveal", path: captured.dir });
      await refreshDir(captured.dir);
      if (captured.kind === "file") {
        openFile({ name, type: "file", size: "" }, [...captured.dir, name]);
      }
    });
  };
  const deleteItem = () => {
    const captured = deleting;
    setDeleting(null);
    if (captured) {
      void run(async () => {
        await ops.deletePath(captured.abs);
        await refreshAbs(dirName(captured.abs));
      });
    }
  };
  const dialogs = {
    creating,
    deleting,
    setCreating,
    setDeleting,
    validateName,
    createItem,
    deleteItem,
  };

  return { menuFor, renaming, setRenaming, commitRename, moveInto, dialogs };
}
