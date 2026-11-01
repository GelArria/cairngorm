import { isEditable } from "@/common/dom/input-targets";
import { ChevronIcon } from "@/common/ui/animated-icon";
import type { ExpandCmd, FileNode } from "@/workspace/model/types";
import { useCallback, useEffect, useState } from "preact/hooks";
import { gitMark } from "../model/file-icon";
import { FileTypeIcon } from "./file-type-icon";

// The row being dragged. Module scope: the drop lands on ANOTHER row instance.
let dragSource: string[] | null = null;

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  path: string[];
  onContextMenu: (e: MouseEvent, nodePath: string[], node: FileNode) => void;
  onClickFile: (node: FileNode, path: string[]) => void;
  onMoveNode?: (fromPath: string[], toPath: string[]) => void;
  renamingPath: string[] | null;
  renamingValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /** Git porcelain code for a root-relative "a/b/c" path (Sidebar v2 M/A/U marks). */
  gitCodeOf?: (relPath: string) => string | undefined;
  /** Root-relative path of the last clicked file — highlighted. */
  selectedPath?: string | null;
  /** Latest expand / collapse / reveal request from the context menu. */
  expandCmd?: ExpandCmd | null;
}

// Tree guide lines: one 1px rule per ancestor level, at 11 + 16·level px.
function guides(depth: number) {
  if (depth === 0) {
    return undefined;
  }
  const rules = Array.from(
    { length: depth },
    () => "linear-gradient(hsl(var(--border)),hsl(var(--border)))",
  );
  return {
    backgroundImage: rules.join(","),
    backgroundRepeat: "no-repeat",
    backgroundSize: "1px 100%",
    backgroundPosition: Array.from({ length: depth }, (_, l) => `${11 + 16 * l}px 0`).join(","),
  };
}

export function FileTreeItem(props: FileTreeItemProps) {
  const {
    node,
    depth,
    path,
    onContextMenu,
    onClickFile,
    onMoveNode,
    renamingPath,
    renamingValue,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    gitCodeOf,
    selectedPath,
    expandCmd,
  } = props;
  const [expanded, setExpanded] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const isRenaming = renamingPath && path.join("/") === renamingPath.join("/");
  const rel = path.join("/");
  const mark = node.type === "file" ? gitMark(gitCodeOf?.(rel)) : null;
  const selected = node.type === "file" && selectedPath === rel;

  const key = path.join("/");
  useEffect(() => {
    if (!expandCmd || node.type !== "folder") {
      return;
    }
    const target = expandCmd.path.join("/");
    const under = target === "" || key === target || key.startsWith(target + "/"); // this row is the target or below it
    const above = target === key || target.startsWith(key + "/"); // this row is the target or an ancestor
    if (expandCmd.type === "collapse") {
      setExpanded(false);
    } else if (expandCmd.type === "reveal" && above) {
      setExpanded(true);
    } else if (expandCmd.type === "expand" && under && (node.children?.length ?? 0) > 0) {
      setExpanded(true);
    } // only what is loaded
  }, [expandCmd?.id]);

  const handleClick = useCallback(() => {
    if (node.type === "folder") {
      setExpanded(!expanded);
      if (expanded) {
        return;
      } // collapsing — no need to re-list the folder
    }
    onClickFile(node, path);
  }, [node, onClickFile, path, expanded]);

  const handleCtx = useCallback(
    (evt: MouseEvent) => {
      if (isEditable(evt.target)) {
        return;
      } // the inline rename field keeps Cut / Copy / Paste
      evt.preventDefault();
      evt.stopPropagation();
      onContextMenu(evt, path, node);
    },
    [path, node, onContextMenu],
  );

  return (
    <div onContextMenu={handleCtx}>
      <div
        data-testid="file-tree-row"
        class={`group mx-1.5 flex h-6 min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-[5px] pr-2.5 text-xs transition-colors ${
          dropOver ? "bg-accent ring-1 ring-primary" : selected ? "bg-accent" : "hover:bg-secondary"
        }`}
        style={{ paddingLeft: `${6 + depth * 16}px`, ...guides(depth) }}
        onClick={isRenaming ? undefined : handleClick}
        draggable
        onDragStart={() => {
          dragSource = path;
        }}
        onDragOver={(e) => {
          if (!onMoveNode || node.type !== "folder") {
            return;
          }
          e.preventDefault();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropOver(false);
          if (onMoveNode && dragSource && node.type === "folder") {
            const src = dragSource;
            if (src.join("/") !== path.join("/")) {
              onMoveNode(src, path);
            }
          }
          dragSource = null;
        }}
        onDragEnd={() => {
          dragSource = null;
          setDropOver(false);
        }}
      >
        {node.type === "folder" ? (
          <>
            <ChevronIcon open={expanded} class="w-2.5 text-[10px] text-muted-foreground/70" />
            <FileTypeIcon name={node.name} folder open={expanded} />
          </>
        ) : (
          <>
            <span class="w-2.5 shrink-0" />
            <FileTypeIcon name={node.name} />
          </>
        )}
        {isRenaming ? (
          <input
            class="min-w-0 flex-1 border-b border-foreground bg-transparent text-xs outline-none"
            value={renamingValue}
            onInput={(e) => onRenameChange((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRenameCommit();
              }
              if (e.key === "Escape") {
                onRenameCancel();
              }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span class="min-w-0 flex-1 truncate text-foreground/90">{node.name}</span>
        )}
        {node.size && !isRenaming && (
          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {node.size}
          </span>
        )}
        {mark && !isRenaming && (
          <span class={`w-2.5 shrink-0 text-center font-mono text-[10px] ${mark.cls}`}>
            {mark.letter}
          </span>
        )}
      </div>
      {node.type === "folder" && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.name}
              {...props}
              node={child}
              depth={depth + 1}
              path={[...path, child.name]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
