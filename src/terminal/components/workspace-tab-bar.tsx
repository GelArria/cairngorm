import { tagHex } from "@/appearance/model/tag-colors";
import { ContextMenu } from "@/common/components/context-menu";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups as menuGroups } from "@/common/model/context-menu";
import { useTerminalBulkClose } from "../hooks/use-terminal-bulk-close";
import { projectLayouts } from "../model/layout/split-groups";
import { tabBarSegments } from "../model/tab-grouping";
import { launchMenu } from "../runtime/launch-actions";
import { ShellMenu } from "./shell-menu";
import { SplitGroupChip } from "./split-group-chip";
import { TerminalTabBarActions } from "./terminal-tab-bar-actions";

import type { ComponentProps, RefObject } from "preact";
import { WorkspaceTabItem } from "./workspace-tab-item";
interface Props extends Omit<ComponentProps<typeof WorkspaceTabItem>, "tab"> {
  dockedBar: boolean;
  tabBarRef: RefObject<HTMLDivElement>;
  launch: ComponentProps<typeof ShellMenu>;
  bulk: ReturnType<typeof useTerminalBulkClose>;
  embedded?: boolean;
}
export function WorkspaceTabBar({
  workspace,
  dockedBar,
  tabBarRef,
  launch,
  bulk,
  embedded,
  renamingTabId,
  setRenamingTabId,
  handleFocusDetached,
  showWorkspace,
  guardedClose,
  handleDetach,
  openPaneMenu,
  dock,
}: Props) {
  const { state, splitWithNew, joinSplit, arrangeSplit, dissolveSplit, setGroupColor, ungroupOf } =
    workspace;
  const stripMenu = useContextMenu();
  const groupTabs = state.tabs.filter(
    (t) => !t.hidden && (t.groupId ?? "g1") === state.activeGroupId,
  );
  const segments = tabBarSegments(
    groupTabs,
    projectLayouts(state, state.activeGroupId),
    state.layout,
  );
  // Tabs that can join the group on screen: open here, not already in a group.
  const loose = segments.flatMap((s) =>
    s.kind === "tab" && !s.tab.detached && s.tab.id !== state.activeTabId ? [s.tab] : [],
  );
  // Each split group keeps its own label colour (stored on the group)
  const groupColor = new Map<string, string>();
  for (const seg of segments) {
    const hex = seg.kind === "group" ? tagHex(seg.color) : undefined;
    for (const t of seg.kind === "group" && hex ? seg.members : []) {
      groupColor.set(t.id, hex!);
    }
  }
  let groupNumber = 0;
  const renderTab = (tab: import("../model/types").TermTab) => (
    <WorkspaceTabItem
      key={tab.id}
      tab={tab}
      groupColor={groupColor.get(tab.id)}
      workspace={workspace}
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
    <div
      class={`workspace-tab-bar flex h-9 min-w-0 shrink-0 items-center font-mono ${dockedBar ? "flex-1" : "surface-tabs border-b border-border bg-card"}`}
    >
      {/* Terminal tabs anchored left */}
      <div
        ref={tabBarRef}
        role="tablist"
        aria-label="Workspace tabs"
        class="flex flex-1 items-center min-w-0 overflow-x-auto"
        onContextMenu={(e) =>
          stripMenu.open(
            e,
            menuGroups(launchMenu(launch), [
              {
                label: "Close all terminals…",
                action: bulk.closeAll,
                danger: true,
                disabled: bulk.count === 0,
              },
            ]),
          )
        }
        onKeyDown={(e) => {
          if ((e.target as Element).getAttribute("role") !== "tab") {
            return;
          }
          const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = tabs.indexOf(e.target as HTMLButtonElement);
          let next = index;
          if (e.key === "ArrowRight") {
            next = (index + 1) % tabs.length;
          } else if (e.key === "ArrowLeft") {
            next = (index + tabs.length - 1) % tabs.length;
          } else if (e.key === "Home") {
            next = 0;
          } else if (e.key === "End") {
            next = tabs.length - 1;
          } else {
            return;
          }
          e.preventDefault();
          tabs[next]?.focus();
          tabs[next]?.click();
        }}
      >
        {segments.map((seg) =>
          seg.kind === "tab" ? (
            renderTab(seg.tab)
          ) : (
            <div
              key={seg.members[0].id}
              data-split-group
              data-shown={seg.shown}
              title={seg.shown ? "Split group on screen" : "Split group — select a tab to show it"}
              // The whole group shares a tint of its colour, so its tabs read as one block
              class="flex shrink-0 items-center self-stretch"
              style={{
                background: `${groupColor.get(seg.members[0].id) ?? "#888888"}${seg.shown ? "26" : "14"}`,
              }}
            >
              <SplitGroupChip
                number={++groupNumber}
                color={seg.color}
                shown={seg.shown}
                onColor={(c) => setGroupColor(seg.members[0].id, c)}
                onUngroup={() => ungroupOf(seg.members[0].id)}
              />
              {seg.members.map(renderTab)}
            </div>
          ),
        )}
        <ShellMenu {...launch} />
        <ContextMenu menu={stripMenu.menu} />
      </div>
      <div class="w-px h-4 bg-border/40 shrink-0" />
      <TerminalTabBarActions
        canSplit={!!state.activeTabId}
        canToggleSplit={!embedded && !state.layout}
        hasSplit={!!state.layout}
        candidates={loose}
        onSplitNew={() => splitWithNew()}
        onJoin={(id) => joinSplit(id)}
        onArrange={arrangeSplit}
        onUngroup={dissolveSplit}
      />
    </div>
  );
}
