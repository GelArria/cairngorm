import { UnifiedContextMenu } from "@/common/components/unified-context-menu";
import { SEP, type ContextMenuItem } from "@/common/model/context-menu";

/** Clipboard-style actions on the pane's terminal (absent for file panes / Chat UI). */
export interface PaneEdit {
  canCopy: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

interface Props {
  edit?: PaneEdit;
  x: number;
  y: number;
  canZoom: boolean;
  zoomed: boolean;
  onRename: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  /** Loose tab: join the split group on screen (or pair with the visible tab). */
  onJoinSplit?: () => void;
  /** Group member: leave the split group and stay open as a loose tab. */
  onRemoveFromSplit?: () => void;
  onZoom: () => void;
  onClose: () => void;
  onCloseOthers?: () => void;
  canCloseOthers?: boolean;
  onCloseAll?: () => void;
  canCloseAll?: boolean;
  /** Agent panes: toggle TUI ⇄ Chat UI for this pane (hidden in shell panes) */
  isAgent?: boolean;
  viewMode?: "tui" | "chat";
  onToggleView?: () => void;
  onOpenTestBrowser?: () => void;
  onCloseMenu: () => void;
}

// Right-click menu on a terminal pane / its tab button (Windows Terminal style)
export function TerminalPaneContextMenu({
  edit,
  x,
  y,
  canZoom,
  zoomed,
  onRename,
  onSplitRight,
  onSplitDown,
  onJoinSplit,
  onRemoveFromSplit,
  onZoom,
  onClose,
  isAgent,
  viewMode,
  onToggleView,
  onOpenTestBrowser,
  onCloseMenu,
  onCloseOthers,
  canCloseOthers,
  onCloseAll,
  canCloseAll,
}: Props) {
  const items: ContextMenuItem[] = [
    ...(edit
      ? ([
          { label: "Copy", action: edit.onCopy, disabled: !edit.canCopy },
          { label: "Paste", action: edit.onPaste },
          { label: "Select All", action: edit.onSelectAll },
          { label: "Clear", action: edit.onClear },
          { ...SEP },
        ] as ContextMenuItem[])
      : []),
    ...(isAgent && onToggleView
      ? [
          {
            label: viewMode === "chat" ? "Show TUI" : "Show Chat UI",
            action: onToggleView,
          } as ContextMenuItem,
        ]
      : []),
    ...(onOpenTestBrowser ? [{ label: "Open test browser", action: onOpenTestBrowser }] : []),
    { label: "Rename pane", action: onRename },
    { ...SEP },
    { label: "Split right", action: onSplitRight },
    { label: "Split down", action: onSplitDown },
    ...(onJoinSplit ? [{ label: "Add to split", action: onJoinSplit }] : []),
    ...(onRemoveFromSplit ? [{ label: "Remove from split", action: onRemoveFromSplit }] : []),
    { label: zoomed ? "Restore pane" : "Zoom pane", action: onZoom, disabled: !canZoom },
    { ...SEP },
    { label: "Close pane", action: onClose, danger: true },
    ...(onCloseOthers
      ? [
          {
            label: "Close other terminals…",
            action: onCloseOthers,
            danger: true,
            disabled: !canCloseOthers,
          },
        ]
      : []),
    ...(onCloseAll
      ? [
          {
            label: "Close all terminals…",
            action: onCloseAll,
            danger: true,
            disabled: !canCloseAll,
          },
        ]
      : []),
  ];
  return <UnifiedContextMenu x={x} y={y} items={items} onClose={onCloseMenu} />;
}
