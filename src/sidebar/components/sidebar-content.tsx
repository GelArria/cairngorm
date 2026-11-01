import { LazyCalendarView } from "@/app/lazy-views";
import { ContextMenu } from "@/common/components/context-menu";
import { ModuleErrorBoundary } from "@/common/components/module-error-boundary";
import { ViewKeepAlive } from "@/common/components/view-keep-alive";
import { requestNewProject } from "@/common/events/app-events";
import { groups as menuGroups } from "@/common/model/context-menu";
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Icon } from "@/common/ui/icon";
import { ScrollArea } from "@/common/ui/scroll-area";
import { GitPanel } from "@/git/git-panel";
import { WorkspacePanel } from "@/workspace/workspace-panel";
import "../sidebar.css";
import { ActiveProjectHeader } from "./active-project-header";
import { ProjectTerminals } from "./project-terminals";
import { SidebarFooter } from "./sidebar-footer";

import type { useSidebarState } from "../hooks/use-sidebar-state";
interface Props {
  sidebar: ReturnType<typeof useSidebarState>;
}
export function SidebarContent({ sidebar }: Props) {
  const {
    side,
    horizontal,
    collapsed,
    setCollapsed,
    git,
    bgMenu,
    open,
    activeProject,
    activeProjectId,
    closePanel,
    toggleModule,
    newTerminal,
    bulk,
  } = sidebar;
  return (
    <div
      data-testid="sidebar"
      data-side={side}
      data-panel={horizontal ? (open ?? undefined) : undefined}
      // select-none: dragging across rows must not paint text selections (inputs still select)
      id={horizontal ? "sidebar-dock-panel" : undefined}
      role={horizontal ? "region" : undefined}
      aria-label={horizontal && open ? `${open} panel` : undefined}
      class={`sidebar-container select-none flex-col overflow-x-hidden ${horizontal ? "dock-panel" : "h-full"} ${(horizontal ? !open : collapsed) ? "hidden" : "flex"}`}
    >
      {/* Layout (dock style): project picker · modules · its terminals or open module */}
      {horizontal && (
        <div class="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
          <span class="truncate text-xs font-medium">
            {activeProject?.name}{" "}
            <span class="text-muted-foreground">
              / {open === "files" ? "Files" : open === "git" ? "Git" : "Calendar"}
            </span>
          </span>
          <Button variant="subtle" size="icon-sm" aria-label="Close panel" onClick={closePanel}>
            <Icon name="x" />
          </Button>
        </div>
      )}
      <div class={horizontal ? "hidden" : "contents"}>
        <ActiveProjectHeader
          animate={!collapsed && !horizontal}
          open={open}
          gitChanges={git.files.length}
          onToggle={toggleModule}
          onNewTerminal={newTerminal}
        />
      </div>

      {/* File explorer — kept mounted, only display-toggled: the tree loads
          once and keeps its state (no re-fetch + remount hiccup on reopen) */}
      <div class={open === "files" ? "flex-1 min-h-0 animate-in fade-in duration-150" : "hidden"}>
        <WorkspacePanel />
      </div>
      {open === "git" && (
        <div class="flex flex-col flex-1 min-h-0 animate-in fade-in duration-150">
          {/* keyed: a commit draft / selection never carries over to another project */}
          <GitPanel key={activeProjectId} />
        </div>
      )}
      <ViewKeepAlive active={open === "calendar"}>
        <ModuleErrorBoundary module="calendar">
          <LazyCalendarView projectId={activeProjectId ?? null} compact />
        </ModuleErrorBoundary>
      </ViewKeepAlive>
      {!open && !horizontal && (
        <ScrollArea
          class="flex flex-col flex-1 min-h-0 pb-1 animate-in fade-in duration-150"
          onContextMenu={(e: MouseEvent) =>
            bgMenu.open(
              e,
              menuGroups(
                [
                  { label: "New Terminal", action: () => newTerminal() },
                  { label: "Open", action: () => requestNewProject() },
                ],
                [
                  {
                    label: "Close all terminals…",
                    action: bulk.closeAll,
                    danger: true,
                    disabled: bulk.count === 0,
                  },
                ],
              ),
            )
          }
        >
          <ProjectTerminals onNewTerminal={() => newTerminal()} />
        </ScrollArea>
      )}

      <ContextMenu menu={bgMenu.menu} />
      <ConfirmDialog {...bulk.dialog} />
      {!horizontal && (
        <SidebarFooter
          side={side}
          onCollapse={() => setCollapsed(true)}
          git={git}
          onOpenGit={() => {
            if (open !== "git") {
              toggleModule("git");
            }
          }}
        />
      )}
    </div>
  );
}
