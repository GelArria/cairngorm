import { useEffect } from "preact/hooks";
import { setGridAspect } from "../model/layout/grid-aspect";
import { getRowRatios } from "../model/layout/track-sizing";
import { ANTS_HTML } from "../runtime/pane-drag-preview";
import type { ChatViewMode } from "../shared/agent-events";
import { TerminalEmptyState } from "./terminal-empty-state";
import { WorkspacePane } from "./workspace-pane";

import type { ComponentProps, RefObject } from "preact";
interface Props extends Omit<ComponentProps<typeof WorkspacePane>, "tab"> {
  areaRef: RefObject<HTMLDivElement>;
  gridRef: RefObject<HTMLDivElement>;
  dockZoneRef: RefObject<HTMLDivElement>;
  holeGlowRef: RefObject<HTMLDivElement>;
  empty: ComponentProps<typeof TerminalEmptyState>;
}
export function TerminalGrid({
  workspace,
  agent,
  zoomedTabId,
  setZoomedTabId,
  paneModeOf,
  embedded,
  openPaneMenu,
  handleDetach,
  handleFocusDetached,
  areaRef,
  gridRef,
  dockZoneRef,
  holeGlowRef,
  empty,
}: Omit<Props, "paneMode"> & { paneModeOf: (id: string) => ChatViewMode }) {
  const { state, inlineTabs } = workspace;
  // App panes retain their native docking lease across projects; unmounting restores the window.
  const mountedTabs = state.tabs.filter(
    (t) => !t.detached && (t.kind === "app" || (t.groupId ?? "g1") === state.activeGroupId),
  );
  // Automatic arrangements pick side-by-side vs stacked from the area's shape.
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(() => setGridAspect(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [areaRef]);
  return (
    <>
      {/* Terminal area — unified render path with stable keys.
          Switching between split and non-split doesn't unmount TerminalTab
          because the parent <div> and child keys (tab.id) stay constant. */}
      <div ref={areaRef} class="flex-1 min-h-0 overflow-hidden relative">
        {/* Dock zone while a tab from the bar is dragged over a pane */}
        <div
          ref={dockZoneRef}
          data-testid="dock-zone"
          class="ants pointer-events-none absolute z-40 hidden rounded bg-primary/15 transition-[left,top,width,height] duration-100"
          dangerouslySetInnerHTML={{ __html: ANTS_HTML }}
        />
        {/* Highlight of the target gap during a pane drag */}
        <div
          ref={holeGlowRef}
          class="ants absolute z-30 hidden rounded bg-primary/10"
          dangerouslySetInnerHTML={{ __html: ANTS_HTML }}
        />
        {mountedTabs.length >= 1 ? (
          <div
            ref={gridRef}
            class="surface-grid w-full h-full overflow-hidden"
            style={
              state.layout && inlineTabs.length >= 2
                ? {
                    display: "grid",
                    gridTemplateColumns: zoomedTabId
                      ? "1fr"
                      : state.layout.columnRatios.map((r) => `${r}fr`).join(" "),
                    gridTemplateRows: zoomedTabId
                      ? "1fr"
                      : getRowRatios(state.layout)
                          .map((r) => `minmax(0, ${r}fr)`)
                          .join(" "),
                    gap: "2px",
                    padding: "2px",
                    background: "hsl(var(--border))",
                  }
                : undefined
            }
          >
            {inlineTabs.length === 0 && <TerminalEmptyState {...empty} />}
            {mountedTabs.map((tab) => (
              <WorkspacePane
                key={tab.id}
                tab={tab}
                workspace={workspace}
                agent={agent}
                zoomedTabId={zoomedTabId}
                setZoomedTabId={setZoomedTabId}
                paneMode={paneModeOf(tab.id)}
                embedded={embedded}
                openPaneMenu={openPaneMenu}
                handleDetach={handleDetach}
                handleFocusDetached={handleFocusDetached}
              />
            ))}
          </div>
        ) : (
          <TerminalEmptyState {...empty} />
        )}
      </div>
    </>
  );
}
