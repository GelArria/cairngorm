import { useKeybinds } from "@/keybindings/hooks/use-keybinds";
import { switchProject } from "@/projects";
import { useTerminalTabs } from "./use-terminal-tabs";

import type { RefObject } from "preact";
interface WorkspaceKeybindOptions {
  workspace: ReturnType<typeof useTerminalTabs>;
  embedded?: boolean;
  tabBarRef: RefObject<HTMLDivElement>;
  areaRef: RefObject<HTMLDivElement>;
  zoomedTabId: string | null;
  setZoomedTabId: (id: string | null) => void;
  newAgent: () => void;
}
export function useWorkspaceKeybinds({
  workspace,
  embedded,
  tabBarRef,
  areaRef,
  zoomedTabId,
  setZoomedTabId,
  newAgent,
}: WorkspaceKeybindOptions) {
  const { state, inlineTabs, setActiveTab, closeTab, openTab, splitTab } = workspace;
  const cycleTab = (direction: number) => {
    const index = inlineTabs.findIndex((t) => t.id === state.activeTabId);
    const tab = inlineTabs[(index + direction + inlineTabs.length) % inlineTabs.length];
    if (tab) {
      tabBarRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"] [role="tab"]`)
        ?.focus();
      setZoomedTabId(null);
      setActiveTab(tab.id);
    }
  };
  const cycleProject = (direction: number) => {
    const index = state.groups.findIndex((g) => g.id === state.activeGroupId);
    const group = state.groups[(index + direction + state.groups.length) % state.groups.length];
    if (group) {
      switchProject(group.id);
    }
  };
  const activePane = inlineTabs.find((t) => t.id === state.activeTabId);
  useKeybinds(
    {
      newTerminalInPane: () => openTab(),
      newAgent,
      nextTab: inlineTabs.length > 1 ? () => cycleTab(1) : undefined,
      previousTab: inlineTabs.length > 1 ? () => cycleTab(-1) : undefined,
      nextProject: !embedded && state.groups.length > 1 ? () => cycleProject(1) : undefined,
      previousProject: !embedded && state.groups.length > 1 ? () => cycleProject(-1) : undefined,
      closePane: activePane ? () => closeTab(activePane.id) : undefined,
      splitHorizontal: activePane
        ? () => {
            setZoomedTabId(null);
            splitTab(activePane.id, "horizontal");
          }
        : undefined,
      zoomPane:
        activePane && state.layout
          ? () => setZoomedTabId(zoomedTabId ? null : activePane.id)
          : undefined,
    },
    () => !!areaRef.current && areaRef.current.offsetParent !== null,
  );
}
