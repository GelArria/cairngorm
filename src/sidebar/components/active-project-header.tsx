import { ContextMenu } from "@/common/components/context-menu";
// Selected project, dock style: a picker (gem + name, opens every project as tiles),
// then the project's modules. The branch lives in the footer and on each terminal; the
// navigation position in the title bar. Right-click to rename, change folder or look.
import { toggleFrozen, useSystemMotion } from "@/appearance/data/motion-preferences";
import { useGemDisplay } from "@/appearance/hooks/use-gem-display";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups as menuGroups } from "@/common/model/context-menu";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Popover } from "@/common/ui/popover";
import { pickProjectFolder, useActiveProject } from "@/projects/index";
import { gemYaw, ProjectGem, projectStone } from "@/projects/visuals";
import { useEffect, useState } from "preact/hooks";
import { BackgroundDialog } from "./background-dialog";
import { ProjectModules, type ModuleId, type ProjectModule } from "./project-modules";
import { ProjectNameInput } from "./project-name-input";
import { ProjectsGrid } from "./projects-grid";

interface Props {
  /** false while the sidebar is collapsed (the header is display:none): no frame loop */
  animate: boolean;
  open: ProjectModule | null;
  gitChanges: number;
  onToggle: (m: ModuleId) => void;
  onNewTerminal: (projectId?: string) => void;
}

export function ActiveProjectHeader({ animate, open, gitChanges, onToggle, onNewTerminal }: Props) {
  const project = useActiveProject();
  const cm = useContextMenu();
  const display = useGemDisplay();
  const [editing, setEditing] = useState<"rename" | "gem" | null>(null);
  const [picking, setPicking] = useState(false);
  // Picking another project is the picker's answer: close it then. Clicking the
  // current tile keeps it open (double-click renames that tile in place).
  useEffect(() => setPicking(false), [project?.id]);
  if (!project) {
    return null;
  }
  const stone = projectStone(project);
  const menu = (e: MouseEvent) =>
    cm.open(
      e,
      menuGroups(
        [
          { label: "Rename…", action: () => setEditing("rename") },
          { label: "Change Folder…", action: () => pickProjectFolder(project.id) },
          { label: "Change Appearance…", action: () => setEditing("gem") },
        ],
        [
          {
            label: display.frozen ? "Unfreeze 3D Rotation" : "Freeze 3D Rotation",
            action: toggleFrozen,
          },
          ...(display.forceMotion
            ? [{ label: "Use System Motion Setting", action: useSystemMotion }]
            : []),
        ],
      ),
    );
  return (
    <div
      class="flex shrink-0 flex-col gap-1.5 px-1.5 pt-1.5"
      data-testid="active-project"
      style={{ "--accent-stone": stone.color }}
      onContextMenu={menu}
    >
      <div data-testid="active-project-card" class="flex min-w-0">
        {editing === "rename" ? (
          <ProjectNameInput
            key={project.id}
            project={project}
            onClose={() => setEditing(null)}
            // Same footprint as the card: the name stays where it was while editing.
            class="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-border bg-card px-10"
            inputClass="h-6 text-center text-[13px]"
          />
        ) : (
          <Popover
            open={picking}
            onOpenChange={setPicking}
            label="Projects"
            // Tile menus open dialogs (appearance, rename): they must cover the picker.
            belowDialogs
            class="min-w-0 flex-1"
            triggerClass="w-full min-w-0"
            trigger={(props) => (
              <Button
                {...props}
                variant="subtle"
                size="sm"
                data-testid="sidebar-project-picker"
                // The folder, on demand: the name already says which project this is.
                title={project.rootPath ?? "Choose project"}
                // Equal side slots (gem | caret) keep the name centered on the whole card.
                class="grid h-11 w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1 rounded-xl border border-border bg-card px-1.5"
              >
                <span class="flex items-center justify-center">
                  <ProjectGem
                    color={stone.color}
                    cut={project.cut}
                    yaw={gemYaw(project.id)}
                    size={30}
                    spin={animate}
                  />
                </span>
                <span
                  class="min-w-0 truncate text-center text-[13px] font-semibold text-foreground"
                  data-testid="active-project-name"
                >
                  {project.name}
                </span>
                <span class="flex items-center justify-center">
                  <Icon name="caret-down" class="text-[11px] text-muted-foreground" />
                </span>
              </Button>
            )}
          >
            <div class="w-[320px] max-w-[calc(100vw-32px)]">
              <ProjectsGrid onNewTerminal={onNewTerminal} />
            </div>
          </Popover>
        )}
      </div>
      <ProjectModules
        open={open}
        gitChanges={gitChanges}
        accent={stone.color}
        onToggle={onToggle}
      />
      <ContextMenu menu={cm.menu} />
      <BackgroundDialog
        project={editing === "gem" ? project : null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
