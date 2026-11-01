import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { useAgentEvents } from "../hooks/use-agent-events";
import { useTerminalTabs } from "../hooks/use-terminal-tabs";
import { getRowRatios } from "../model/layout/track-sizing";
import { getTrackSpace, startColumnResize, startRowResize } from "../runtime/column-resize";
import { getTerm } from "../runtime/term-registry";
import type { ChatViewMode } from "../shared/agent-events";
import { WorkspacePaneContent } from "./workspace-pane-content";

import type { TermTab } from "../model/types";

/** macOS reports Ctrl+click as a primary mousedown followed by a context menu. */
const IS_MAC = navigator.platform.startsWith("Mac");

interface WorkspacePaneProps {
  tab: TermTab;
  workspace: ReturnType<typeof useTerminalTabs>;
  agent: ReturnType<typeof useAgentEvents>;
  zoomedTabId: string | null;
  setZoomedTabId: (id: string | null) => void;
  paneMode: ChatViewMode;
  embedded?: boolean;
  openPaneMenu: (id: string, e: Event) => void;
  handleDetach: (id: string) => void;
  handleFocusDetached: (label: string) => void;
}

export function WorkspacePane({
  tab,
  workspace,
  agent,
  zoomedTabId,
  setZoomedTabId,
  paneMode,
  embedded,
  openPaneMenu,
  handleDetach,
  handleFocusDetached,
}: WorkspacePaneProps) {
  const { state, inlineTabs, setActiveTab, resizeColumns, resizeRows } = workspace;
  const cell = state.layout?.cells.find((c) => c.tabId === tab.id);
  const rows = state.layout ? getRowRatios(state.layout) : [];
  const inActiveProject = (tab.groupId ?? "g1") === state.activeGroupId;
  const isSplit = inActiveProject && !tab.hidden && !!(state.layout && inlineTabs.length >= 2);
  const isActive = tab.id === state.activeTabId;
  const isZoomed = zoomedTabId === tab.id;
  const hiddenByZoom = !!zoomedTabId && !isZoomed;
  // Terminals and other panes (files, tests, plugins) keep separate opacities.
  const surface = tab.kind ? "surface-panel" : "surface-terminal";
  return (
    <div
      data-pane-id={tab.id}
      data-active={isActive}
      aria-hidden={!inActiveProject || tab.hidden || undefined}
      class={
        isSplit
          ? // frame as absolute overlay: a border on the wrapper would re-fit the xterm on every switch
            `${surface} group relative overflow-hidden`
          : `${surface} group relative w-full h-full`
      }
      onMouseDownCapture={(e) => {
        // Right-click belongs to the pane menu; a mouse-aware TUI (pi) would
        // otherwise also receive it and act on it (pi pastes on right-click).
        const secondary = e.button === 2 || (IS_MAC && e.button === 0 && e.ctrlKey);
        if (secondary && (e.target as Element)?.closest?.(".xterm")) {
          // Do what xterm's skipped mousedown would: keep focus in the terminal.
          e.preventDefault();
          e.stopPropagation();
          getTerm(tab.sessionId)?.focus();
          if (isSplit && !isActive) {
            setActiveTab(tab.id);
          }
        }
      }}
      onMouseDown={isSplit && !isActive ? () => setActiveTab(tab.id) : undefined}
      onDblClick={
        isSplit
          ? (e) => {
              if ((e.target as Element)?.closest?.(".xterm, .cm-editor, input, textarea")) {
                return;
              }
              e.stopPropagation();
              setZoomedTabId(isZoomed ? null : tab.id);
            }
          : undefined
      }
      onContextMenu={(e) => openPaneMenu(tab.id, e)}
      style={
        !inActiveProject
          ? { display: "none" }
          : isSplit && cell
            ? {
                gridColumn: zoomedTabId ? "auto" : `${cell.col + 1} / span ${cell.colSpan}`,
                gridRow: zoomedTabId ? "auto" : `${cell.row + 1} / span ${cell.rowSpan}`,
                display: hiddenByZoom ? "none" : undefined,
              }
            : {
                display: !tab.hidden && tab.id === state.activeTabId ? "block" : "none",
              }
      }
    >
      <WorkspacePaneContent
        tab={tab}
        workspace={workspace}
        agent={agent}
        paneMode={paneMode}
        isActive={isActive}
        handleFocusDetached={handleFocusDetached}
      />
      {isSplit && (
        // Pane frame ABOVE the xterm/WebGL: the opaque bg of
        // .xterm-viewport (xterm CSS default) covers the wrapper outline
        // → the ring only showed as a loose band in the fit lower gap.
        <div
          class={`pane-frame pointer-events-none absolute inset-0 z-10 ${isActive ? "border-2 border-primary/80" : "border border-border/40"}`}
        />
      )}
      {isSplit && !zoomedTabId && (
        <Button
          data-pane-drag
          variant="subtle"
          size="icon-sm"
          class="absolute top-1 left-1.5 z-20 cursor-grab bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Move pane"
          title="Drag to move or swap this pane"
          onClick={() => getTerm(tab.sessionId)?.focus()}
        >
          <Icon name="grip" class="text-sm" />
        </Button>
      )}
      {!embedded &&
        isSplit &&
        !tab.kind &&
        !inlineTabs.some(
          (t) =>
            (t.kind === "tests" || t.kind === "plugin" || t.kind === "app") &&
            !!state.layout?.cells.some((c) => c.tabId === t.id),
        ) && (
          // Group detach: the whole split to ONE window with its layout
          <button
            data-no-drag
            class="absolute top-1 left-9 z-20 h-7 w-7 flex items-center justify-center bg-card border border-border/40 text-sm text-muted-foreground/70 hover:text-foreground hover:bg-accent/70 transition-opacity opacity-0 group-hover:opacity-100"
            title="Detach the split view to a window (keeps the grid)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleDetach(tab.id);
            }}
          >
            <Icon name="arrow-square-out" />
          </button>
        )}
      {isSplit && !zoomedTabId && cell && cell.row + cell.rowSpan < rows.length && (
        <div
          data-row-resizer
          role="separator"
          aria-label="Resize pane height"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(
            (100 * rows.slice(0, cell.row + cell.rowSpan).reduce((a, b) => a + b, 0)) /
              rows.reduce((a, b) => a + b, 0),
          )}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          class="absolute z-10 bottom-0 left-0 right-0 h-[3px] cursor-row-resize hover:bg-primary/40 active:bg-primary/60 focus-visible:bg-primary/60 focus-visible:outline-none"
          onMouseDown={(e) => startRowResize(e, { row: cell.row + cell.rowSpan - 1, resizeRows })}
          onDblClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            const grid = e.currentTarget.closest<HTMLElement>('[style*="grid-template-rows"]');
            resizeRows(
              cell.row + cell.rowSpan - 1,
              e.key === "ArrowDown" ? 10 : -10,
              grid ? getTrackSpace(grid, "rows") : 0,
            );
          }}
        />
      )}
      {null /* Close is available in the pane context menu and through Ctrl+Shift+W. */}
      {null /* Zoom is available in the context menu and through double-click. */}
      {isSplit && !zoomedTabId && cell && cell.col + cell.colSpan < state.layout!.columnCount && (
        <div
          data-col-resizer
          class="absolute z-10 top-0 bottom-0 right-0 w-[3px] cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
          onMouseDown={(e) =>
            startColumnResize(e, { col: cell.col + cell.colSpan - 1, resizeColumns })
          }
        />
      )}
    </div>
  );
}
