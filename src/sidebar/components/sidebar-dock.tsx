import { Button } from "@/common/ui/button";
import { DropdownMenu } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { useActiveProject } from "@/projects/index";
import { gemYaw, ProjectGem, projectStone } from "@/projects/visuals";
import { WorkspaceTabSlot } from "../../common/layout/workspace-tab-slot";
import { ProjectModules, type ModuleId, type ProjectModule } from "./project-modules";
import { ProjectsGrid } from "./projects-grid";

interface Props {
  side: "top" | "bottom";
  open: ProjectModule | null;
  gitChanges: number;
  onModule: (m: ModuleId) => void;
  onNewTerminal: (projectId?: string) => void;
}

export function SidebarDock({ side, open, gitChanges, onModule, onNewTerminal }: Props) {
  const project = useActiveProject();
  const accent = project ? projectStone(project).color : "#d9c4a8";
  const direction = side === "bottom" ? "up" : "down";
  return (
    <nav
      aria-label="Project dock"
      data-testid="sidebar-dock"
      data-side={side}
      class="sidebar-dock pointer-events-none flex h-12 w-full min-w-0 items-center justify-between gap-2 px-2"
    >
      <DropdownMenu
        key={project?.id}
        belowDialogs
        direction={direction}
        trigger={
          <Button
            variant="subtle"
            size="sm"
            data-testid="dock-project-picker"
            class="dock-project-island pointer-events-auto h-9 min-w-0 max-w-[200px] gap-2 rounded-lg border border-border bg-card px-2 shadow-sm"
            aria-label="Choose project"
          >
            {project && (
              <ProjectGem
                color={accent}
                cut={project.cut}
                yaw={gemYaw(project.id)}
                size={24}
                spin
                fps={20}
              />
            )}
            <span class="dock-project-label max-w-[125px] truncate text-xs">
              {project?.name ?? "Projects"}
            </span>
            <Icon name="caret-down" class="shrink-0 text-[10px]" />
          </Button>
        }
      >
        <div class="w-[320px] max-w-[calc(100vw-32px)]">
          <ProjectsGrid onNewTerminal={onNewTerminal} />
        </div>
      </DropdownMenu>
      <span aria-hidden="true" class="h-5 w-px shrink-0 bg-border" />
      <div class="pointer-events-auto flex min-w-0 flex-1">
        <WorkspaceTabSlot />
      </div>
      <span aria-hidden="true" class="h-5 w-px shrink-0 bg-border" />
      <div class="pointer-events-auto flex shrink-0 items-center gap-1">
        <ProjectModules
          dockSide={side}
          open={open}
          gitChanges={gitChanges}
          accent={accent}
          onToggle={onModule}
        />
      </div>
    </nav>
  );
}
