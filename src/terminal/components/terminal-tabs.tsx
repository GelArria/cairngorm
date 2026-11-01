import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { useTerminalTabsView } from "@/terminal/hooks/use-terminal-tabs-view";
import { createPortal } from "preact/compat";
import { AgentLaunchNotice } from "./agent-launch-notice";
import { DetachedBar } from "./detached-bar";
import { TerminalGrid } from "./terminal-grid";
import { WorkspacePaneMenu } from "./workspace-pane-menu";
import { WorkspaceTabBar } from "./workspace-tab-bar";
import { CliLaunchNotice } from "./cli-launch-notice";
import { useCliCatalog } from "../hooks/use-cli-launch";
export { TabButton } from "./tab-button";

export function TerminalTabs({ embedded }: { embedded?: boolean }) {
  useCliCatalog();
  const {
    tabTarget,
    dockedBar,
    workspace,
    inlineTabs,
    detachedTabs,
    zoomedTabId,
    setZoomedTabId,
    renamingTabId,
    setRenamingTabId,
    holeGlowRef,
    areaRef,
    tabBarRef,
    dockZoneRef,
    dock,
    gridRef,
    bulk,
    agent,
    setPaneMode,
    paneModeOf,
    paneMenuState,
    openPaneMenu,
    initStatus,
    initError,
    newAgent,
    dismissAgentProblem,
    showWorkspace,
    launch,
    handleDetach,
    handleFocusDetached,
    guardedClose,
  } = useTerminalTabsView({ embedded });

  const tabBar = (
    <WorkspaceTabBar
      workspace={workspace}
      dockedBar={dockedBar}
      tabBarRef={tabBarRef}
      launch={launch}
      bulk={bulk}
      embedded={embedded}
      renamingTabId={renamingTabId}
      setRenamingTabId={setRenamingTabId}
      handleFocusDetached={handleFocusDetached}
      showWorkspace={showWorkspace}
      guardedClose={guardedClose}
      handleDetach={handleDetach}
      openPaneMenu={openPaneMenu}
      dock={dock}
    />
  );

  return (
    <div class="surface-base flex flex-1 flex-col min-h-0 overflow-hidden bg-background font-mono">
      {dockedBar ? tabTarget && createPortal(tabBar, tabTarget) : tabBar}
      {inlineTabs.length > 0 && initStatus === "error" && (
        <div class="shrink-0 px-2 py-1.5">
          <AgentLaunchNotice error={initError} onRetry={newAgent} onDismiss={dismissAgentProblem} />
        </div>
      )}

      <TerminalGrid
        workspace={workspace}
        agent={agent}
        zoomedTabId={zoomedTabId}
        setZoomedTabId={setZoomedTabId}
        paneModeOf={paneModeOf}
        embedded={embedded}
        openPaneMenu={openPaneMenu}
        handleDetach={handleDetach}
        handleFocusDetached={handleFocusDetached}
        areaRef={areaRef}
        gridRef={gridRef}
        dockZoneRef={dockZoneRef}
        holeGlowRef={holeGlowRef}
        empty={{
          status: initStatus,
          error: initError,
          onRetry: newAgent,
          onDismiss: dismissAgentProblem,
          ...launch,
        }}
      />

      {/* Detached tabs indicator */}
      <DetachedBar tabs={detachedTabs} onFocus={handleFocusDetached} />

      <WorkspacePaneMenu
        workspace={workspace}
        menu={paneMenuState}
        bulk={bulk}
        zoomedTabId={zoomedTabId}
        setZoomedTabId={setZoomedTabId}
        setRenamingTabId={setRenamingTabId}
        paneModeOf={paneModeOf}
        setPaneMode={setPaneMode}
      />
      <ConfirmDialog {...bulk.dialog} />
      <CliLaunchNotice />
    </div>
  );
}
