// Right-click menu of the file tree (Zed project-panel layout). Pure: it only
// decides WHICH entries show for a target; what they do lives in use-file-actions.
import type { ContextMenuItem } from "@/common/model/context-menu";
import { groups } from "@/common/model/context-menu";

export interface FileActions {
  open(): void;
  openInSplit(): void;
  newFile(): void;
  newFolder(): void;
  reveal(): void;
  openDefault(): void;
  openTerminal(): void;
  findInFolder(): void;
  cut(): void;
  copy(): void;
  duplicate(): void;
  paste(): void;
  copyPath(): void;
  copyRelativePath(): void;
  ignore(local: boolean): void;
  rename(): void;
  remove(): void;
  expandAll(): void;
  collapseAll(): void;
}

export interface FileMenuTarget {
  /** "file" | "folder" for a row; "root" for the tree background. */
  kind: "file" | "folder" | "root";
  /** A real folder is open (otherwise only the in-memory dropped files exist). */
  onDisk: boolean;
  /** The open folder sits inside a git repository. */
  inRepo: boolean;
  /** Something was cut / copied earlier. */
  canPaste: boolean;
}

export function buildFileMenu(t: FileMenuTarget, a: FileActions): ContextMenuItem[] {
  const row = t.kind !== "root";
  const item = (
    label: string,
    action: () => void,
    extra: Partial<ContextMenuItem> = {},
  ): ContextMenuItem => ({ label, action, ...extra });

  if (!t.onDisk) {
    // Dropped / pasted files only live in memory: nothing on disk to act on
    return groups(
      [row && t.kind === "file" && item("Open", a.open)],
      [row && item("Copy Path", a.copyPath)],
    );
  }
  return groups(
    [
      t.kind === "file" && item("Open", a.open),
      t.kind === "file" && item("Open in Split", a.openInSplit),
    ],
    [item("New File", a.newFile), item("New Folder", a.newFolder)],
    [
      item("Reveal in File Explorer", a.reveal),
      row && item("Open in Default App", a.openDefault),
      item("Open in Terminal", a.openTerminal),
    ],
    [t.kind !== "file" && item("Find in Folder…", a.findInFolder)],
    [
      row && item("Cut", a.cut),
      row && item("Copy", a.copy),
      row && item("Duplicate", a.duplicate),
      item("Paste", a.paste, { disabled: !t.canPaste }),
    ],
    [row && item("Copy Path", a.copyPath), row && item("Copy Relative Path", a.copyRelativePath)],
    [
      row && t.inRepo && item("Add to .gitignore", () => a.ignore(false)),
      row && t.inRepo && item("Add to .git/info/exclude", () => a.ignore(true)),
    ],
    [row && item("Rename…", a.rename), row && item("Delete", a.remove, { danger: true })],
    [t.kind !== "file" && item("Expand All", a.expandAll), item("Collapse All", a.collapseAll)],
  );
}
