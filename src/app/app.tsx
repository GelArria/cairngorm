import { AppHeader } from "@/app/app-header/app-header";
import { ModuleErrorBoundary } from "@/common/components/module-error-boundary";
import { ViewKeepAlive } from "@/common/components/view-keep-alive";
import { openSettings, openSidebarModule } from "@/common/events/app-events";
import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { setSidebarSide, useSidebarSide } from "@/common/layout/sidebar-side";
import { WorkspaceTabProvider } from "@/common/layout/workspace-tab-slot";
import { useNavHistory } from "@/common/navigation/use-nav-history";
import { PerfOverlay, markViewSwitch, usePerfTracker } from "@/debug/performance/perf-tracker";
import { useKeybinds } from "@/keybindings/hooks/use-keybinds";
import { switchProject } from "@/projects/api";
import { AppSidebar } from "@/sidebar/app-sidebar";
import { FilePermissionDialog, useFilePermissions } from "@/plugins/files";
import { useDetachedWorkspaceEvents, useTerminalTabs } from "@/terminal/workspace";
import { useCallback, useEffect, useState } from "preact/hooks";
import { usePluginMonitor } from "../plugins/hooks/use-plugin-monitor";
import { ChatView } from "../terminal";
import { useTestMonitor } from "../testing/hooks/use-test-monitor";
import { ScheduleDialog } from "./components/schedule-dialog";
import { useAppFileActions } from "./hooks/use-app-file-actions";
import { useMcpWorkspace } from "./hooks/use-mcp-workspace";

export type AppView = "chat" | "calendar";

export default function App() {
  // Narrow windows preserve the chosen dock edge; lateral sidebars use a rail.
  const [explorerOpen, setExplorerOpen] = useLocalStorage("sidebar-explorer-open", false);
  const sidebarSide = useSidebarSide();
  const navigationLayout =
    sidebarSide === "bottom"
      ? "flex-col-reverse"
      : sidebarSide === "top"
        ? "flex-col"
        : sidebarSide === "right"
          ? "flex-row-reverse"
          : "flex-row";
  const [activeView, setActiveView] = useState<AppView>("chat");
  const termTabs = useTerminalTabs({ content: false });
  useTestMonitor(termTabs.state.tabs);
  usePluginMonitor();
  useMcpWorkspace(termTabs.state);
  const filePermission = useFilePermissions(
    termTabs.state.tabs
      .filter((tab) => !tab.kind)
      .flatMap((tab) => {
        const group = termTabs.state.groups.find((group) => group.id === (tab.groupId ?? "g1"));
        return group?.cwd
          ? [{ terminal: tab.sessionId, projectId: group.id, rootPath: group.cwd }]
          : [];
      }),
  );

  // Back / Forward through where you have been in Cairngorm (view, project,
  // focused pane or file) — not code or agent actions.
  const nav = useNavHistory({
    location: {
      view: activeView,
      groupId: termTabs.state.activeGroupId,
      tabId: termTabs.state.activeTabId,
    },
    exists: (l) =>
      (!l.groupId || termTabs.state.groups.some((g) => g.id === l.groupId)) &&
      (!l.tabId || termTabs.state.tabs.some((t) => t.id === l.tabId && !t.hidden)),
    apply: (l) => {
      if (l.view !== activeView) {
        markViewSwitch();
        if (l.view === "calendar") {
          openSidebarModule("calendar");
        } else {
          setActiveView("chat");
        }
      }
      if (l.groupId && l.groupId !== termTabs.state.activeGroupId) {
        switchProject(l.groupId);
      }
      if (l.tabId && l.tabId !== termTabs.state.activeTabId) {
        termTabs.setActiveTab(l.tabId);
      }
    },
  });
  usePerfTracker(activeView);

  useDetachedWorkspaceEvents();

  const activateChat = useCallback(() => setActiveView("chat"), []);
  const showExplorer = useCallback(() => setExplorerOpen(true), []);
  const { handleOpenFile, handleOpenFolder, handleNewFile, handleSaveFile } = useAppFileActions(
    termTabs,
    activateChat,
    showExplorer,
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const view = (e as CustomEvent<AppView>).detail;
      if (view) {
        markViewSwitch();
        setActiveView(view as AppView);
      }
    };
    window.addEventListener("app-switch-view", handler);
    return () => window.removeEventListener("app-switch-view", handler);
  }, []);

  useKeybinds({
    newTerminal: () => {
      markViewSwitch();
      termTabs.openTab();
      setActiveView("chat");
    },
    closeTab: termTabs.state.activeTabId
      ? () => termTabs.closeTab(termTabs.state.activeTabId!)
      : undefined,
    saveFile: handleSaveFile,
    toggleSplit: () => {
      if (termTabs.state.layout) {
        termTabs.dissolveSplit();
      } else if (termTabs.state.activeTabId) {
        termTabs.splitTab(termTabs.state.activeTabId, "vertical");
      }
    },
    toggleFiles: () => setExplorerOpen((v) => !v),
    settings: () => openSettings(),
    newFile: handleNewFile,
    openFile: handleOpenFile,
    openFolder: handleOpenFolder,
    openGit: () => openSidebarModule("git"),
    workspace: () => {
      markViewSwitch();
      setActiveView("chat");
    },
    calendar: () => openSidebarModule("calendar"),
    back: nav.canGoBack ? nav.back : undefined,
    forward: nav.canGoForward ? nav.forward : undefined,
  });

  const handleModeChange = (mode: string) => {
    markViewSwitch();
    setActiveView(mode as AppView);
  };

  return (
    <>
      <WorkspaceTabProvider>
        <div class="surface-base h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col">
          <ModuleErrorBoundary module="header">
            <AppHeader
              onBack={nav.back}
              onForward={nav.forward}
              canGoBack={nav.canGoBack}
              canGoForward={nav.canGoForward}
              onNewFile={handleNewFile}
              onSave={handleSaveFile}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              sidebarSide={sidebarSide}
              onSelectSidebarSide={setSidebarSide}
            />
          </ModuleErrorBoundary>
          <div class={`relative flex min-h-0 flex-1 overflow-hidden ${navigationLayout}`}>
            <ModuleErrorBoundary module="sidebar">
              <AppSidebar
                activeMode={activeView}
                onModeChange={handleModeChange}
                explorerOpen={explorerOpen}
                onToggleExplorer={() => setExplorerOpen((v) => !v)}
              />
            </ModuleErrorBoundary>
            <div
              class="surface-base relative flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-background"
              style={
                sidebarSide === "top"
                  ? { paddingTop: 48 }
                  : sidebarSide === "bottom"
                    ? { paddingBottom: 48 }
                    : undefined
              }
            >
              {/* Sidebar modules never hide or remount the terminal workspace. */}
              <ViewKeepAlive active>
                <ModuleErrorBoundary module="chat">
                  <ChatView />
                </ModuleErrorBoundary>
              </ViewKeepAlive>
            </div>
            <ModuleErrorBoundary module="perf-overlay">
              <PerfOverlay />
            </ModuleErrorBoundary>
          </div>
        </div>
      </WorkspaceTabProvider>
      <ScheduleDialog />
      <FilePermissionDialog
        permission={filePermission}
        terminalName={
          termTabs.state.tabs.find((tab) => tab.sessionId === filePermission.current?.terminal)
            ?.title
        }
        projectName={
          termTabs.state.groups.find((group) => group.id === filePermission.current?.projectId)
            ?.name
        }
      />
    </>
  );
}
