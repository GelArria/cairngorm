import { Resizable } from "@/common/components/resizable";
import { Dialog } from "@/common/ui/dialog";
import { projectStone } from "@/projects/visuals";
import { SidebarCollapsedRail } from "@/sidebar/components/sidebar-collapsed-rail";
import { SidebarContent } from "./components/sidebar-content";
import { SidebarDock } from "./components/sidebar-dock";
import { SidebarFoldGhost } from "./components/sidebar-fold-ghost";
import { useSidebarState, type AppSidebarProps } from "./hooks/use-sidebar-state";
import "./sidebar.css";

export function AppSidebar({
  activeMode = "chat",
  onModeChange,
  explorerOpen = false,
  onToggleExplorer,
}: AppSidebarProps) {
  const sidebar = useSidebarState({ activeMode, onModeChange, explorerOpen, onToggleExplorer });
  const {
    side,
    horizontal,
    collapsed,
    compact,
    mobileOpen,
    setMobileOpen,
    setCollapsed,
    git,
    open,
    toggleModule,
    newTerminal,
    activeProject,
  } = sidebar;
  // Lateral edges fold: drag past the minimum to collapse, pull the rail to expand.
  const foldable = !horizontal && !compact;
  const stone = activeProject ? projectStone(activeProject) : null;

  const content = <SidebarContent sidebar={sidebar} />;

  return (
    <>
      <Resizable
        side={side === "right" ? "right" : "left"}
        fullWidth={horizontal}
        defaultWidth={280}
        minWidth={260}
        maxWidth={450}
        collapsed={compact || collapsed}
        onCollapse={foldable ? () => setCollapsed(true) : undefined}
        onExpand={foldable ? () => setCollapsed(false) : undefined}
        accent={stone?.color}
        class={`${horizontal ? `!absolute pointer-events-none inset-x-0 z-20 ${side === "bottom" ? "bottom-0" : "top-0"}` : `sidebar-fold surface-sidebar relative border-border bg-card z-10 h-full overflow-x-hidden ${side === "left" ? "border-r" : "border-l"}`}`}
      >
        {(!compact || horizontal) && content}
        {foldable && !collapsed && <SidebarFoldGhost />}
        {horizontal && (
          <SidebarDock
            side={side === "top" ? "top" : "bottom"}
            open={open}
            gitChanges={git.files.length}
            onNewTerminal={newTerminal}
            onModule={toggleModule}
          />
        )}
        {!horizontal && (compact || collapsed) && (
          <SidebarCollapsedRail
            onExpand={() => setCollapsed(false)}
            side={side}
            open={open}
            gitChanges={git.files.length}
            // Every module lives in the sidebar: expand straight into its panel.
            onModule={(m) => {
              setCollapsed(false);
              if (open !== m) {
                toggleModule(m);
              }
            }}
          />
        )}
      </Resizable>
      {compact && !horizontal && (
        <Dialog
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          title="Project navigation"
          class="h-full max-w-sm"
        >
          {content}
        </Dialog>
      )}
    </>
  );
}
