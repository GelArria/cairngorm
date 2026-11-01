import { useTabDock } from "../hooks/use-tab-dock";
import { useTerminalTabs } from "../hooks/use-terminal-tabs";
import { getTerm } from "../runtime/term-registry";
import { TabButton } from "./tab-button";

import type { TermTab } from "../model/types";
interface Props {
  tab: TermTab;
  workspace: ReturnType<typeof useTerminalTabs>;
  /** Colour of the split group the tab belongs to (none for loose tabs). */
  groupColor?: string;
  renamingTabId: string | null;
  setRenamingTabId: (id: string | null) => void;
  handleFocusDetached: (label: string) => void;
  showWorkspace: () => void;
  guardedClose: (id: string) => void;
  handleDetach: (id: string) => void;
  openPaneMenu: (id: string, e: Event) => void;
  dock: ReturnType<typeof useTabDock>;
}
export function WorkspaceTabItem({
  tab,
  workspace,
  groupColor,
  renamingTabId,
  setRenamingTabId,
  handleFocusDetached,
  showWorkspace,
  guardedClose,
  handleDetach,
  openPaneMenu,
  dock,
}: Props) {
  const { state, renameTab, setActiveTab, restartTab } = workspace;
  return renamingTabId === tab.id ? (
    <input
      autoFocus
      defaultValue={tab.title}
      onFocus={(e) => (e.target as HTMLInputElement).select()}
      class="w-24 h-6 self-center px-1.5 bg-card text-[11px] font-mono text-foreground outline-none border border-primary/50"
      onBlur={(e) => {
        renameTab(tab.id, (e.target as HTMLInputElement).value);
        setRenamingTabId(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          renameTab(tab.id, (e.target as HTMLInputElement).value);
          setRenamingTabId(null);
        }
        if (e.key === "Escape") {
          setRenamingTabId(null);
        }
      }}
    />
  ) : (
    <TabButton
      key={tab.id}
      tab={tab}
      groupColor={groupColor}
      isActive={tab.id === state.activeTabId}
      onSelect={(keyboard) => {
        if (tab.detached && tab.detachedWindowLabel) {
          handleFocusDetached(tab.detachedWindowLabel);
        } else {
          setActiveTab(tab.id);
          showWorkspace();
          // Pointer selection hands input to the shell; arrows keep focus on the tab.
          if (!keyboard && !tab.kind) {
            requestAnimationFrame(() => getTerm(tab.sessionId)?.focus());
          }
        }
      }}
      onClose={() => guardedClose(tab.id)}
      onDetach={handleDetach}
      onRestart={() => restartTab(tab.id)}
      onContextMenu={(e) => openPaneMenu(tab.id, e)}
      onDragMove={tab.detached ? undefined : (x, y) => dock.move(tab.id, tab.title, x, y)}
      onDragDrop={tab.detached ? undefined : () => dock.drop(tab.id)}
      onDragCancel={dock.cancel}
    />
  );
}
