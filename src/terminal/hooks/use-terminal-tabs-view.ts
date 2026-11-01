import { useSidebarSide } from "@/common/layout/sidebar-side";
import { useWorkspaceTabTarget } from "@/common/layout/workspace-tab-slot";
import { useAgentEvents } from "@/terminal/hooks/use-agent-events";
import { useAgentLaunch } from "@/terminal/hooks/use-agent-launch";
import { useConfiguredShells } from "@/terminal/hooks/use-configured-shells";
import { useDetachedActions } from "@/terminal/hooks/use-detached-actions";
import { usePaneDrag } from "@/terminal/hooks/use-pane-drag";
import { usePaneFocus } from "@/terminal/hooks/use-pane-focus";
import { usePaneMenu } from "@/terminal/hooks/use-pane-menu";
import { useTabDock } from "@/terminal/hooks/use-tab-dock";
import { useTerminalBulkClose } from "@/terminal/hooks/use-terminal-bulk-close";
import { useTerminalTabs } from "@/terminal/hooks/use-terminal-tabs";
import { useWorkspaceKeybinds } from "@/terminal/hooks/use-workspace-keybinds";

import type { ChatViewMode } from "@/terminal/shared/agent-events";
import { useCallback, useEffect, useRef, useState } from "preact/compat";

export function useTerminalTabsView({ embedded }: { embedded?: boolean }) {
  const tabTarget = useWorkspaceTabTarget();
  const sidebarSide = useSidebarSide();
  const dockedBar = !embedded && (sidebarSide === "top" || sidebarSide === "bottom");
  const workspace = useTerminalTabs();
  const { state, inlineTabs, detachedTabs, openTab, closeTab, moveCell, swapCells, dockTab } =
    workspace;
  const shells = useConfiguredShells();
  const lastActionRef = useRef(0);
  const [zoomedTabId, setZoomedTabId] = useState<string | null>(null);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const holeGlowRef = useRef<HTMLDivElement | null>(null);
  // Tab dragged from the bar over the grid → dock preview + dock on release
  const areaRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabBarRef.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [state.activeTabId, state.layout]);
  const dockZoneRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef(false);
  splitRef.current = !!(state.layout && inlineTabs.length >= 2);
  // A docked tab must be seen: leave pane zoom first
  const dock = useTabDock(
    areaRef,
    dockZoneRef,
    (a, b, e) => {
      setZoomedTabId(null);
      dockTab(a, b, e);
    },
    () => splitRef.current,
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const activeGroup = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0];
  const bulk = useTerminalBulkClose({
    tabs: state.tabs,
    groupId: state.activeGroupId,
    groupName: activeGroup?.name,
    closeTab,
  });
  const agent = useAgentEvents();
  // TUI/Chat UI view: the SAME tab-bar toggle as before, but it now applies to
  // ALL agent panes (each pane gets its own view — no single fullscreen takeover).
  // Per-pane divergences live in paneModes; the default is TUI.
  const [paneModes, setPaneModes] = useState<Record<string, ChatViewMode>>({});
  const setPaneMode = (tabId: string, mode: ChatViewMode) =>
    setPaneModes((m) => ({ ...m, [tabId]: mode }));

  const paneModeOf = (tabId: string): ChatViewMode => paneModes[tabId] ?? "tui";

  usePaneFocus({ workspace, areaRef, zoomedTabId, setZoomedTabId });

  const paneMenuState = usePaneMenu(state, paneModeOf);
  const { openPaneMenu } = paneMenuState;

  const { initStatus, initError, newAgent, dismissAgentProblem } = useAgentLaunch(openTab);

  useWorkspaceKeybinds({
    workspace,
    embedded,
    tabBarRef,
    areaRef,
    zoomedTabId,
    setZoomedTabId,
    newAgent,
  });

  const showWorkspace = () => {
    if (dockedBar) {
      window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));
    }
  };
  const launch = {
    shells,
    onOpen: (...args: Parameters<typeof openTab>) => {
      showWorkspace();
      openTab(...args);
    },
    onNewAgent: () => {
      showWorkspace();
      return newAgent();
    },
    agentStarting: initStatus === "loading",
  };

  // NOTE: the `terminal-reattach` listener lives in App (src/app/app.tsx) — not here:
  // ViewKeepAlive unmounts TerminalTabs after 60s outside the chat and the reattach
  // used to become a silent no-op (orphaned PTYs).

  const { handleDetach, handleFocusDetached } = useDetachedActions(workspace, embedded);

  // Close with guard (anti double-fire click+mousedown) shared by bar and mini-tabs
  const guardedClose = useCallback(
    (tabId: string) => {
      const now = Date.now();
      if (now - lastActionRef.current < 100) {
        return;
      }
      lastActionRef.current = now;
      closeTab(tabId);
    },
    [closeTab],
  );

  usePaneDrag({ gridRef, holeGlowRef, state, zoomedTabId, handleDetach, moveCell, swapCells });
  return {
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
  };
}
