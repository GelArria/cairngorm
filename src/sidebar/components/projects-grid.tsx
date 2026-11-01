import { ContextMenu } from "@/common/components/context-menu";
import { useProjectsGrid } from "@/sidebar/hooks/use-projects-grid";
// Every project as a tile in a 2-column grid (scrolls when there are many), shown
// by the project pickers. Click selects the project; right-click manages it.
import { requestNewProject } from "@/common/events/app-events";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { ScrollArea } from "@/common/ui/scroll-area";
import { switchProject } from "@/projects/index";
import { rollupState } from "@/sidebar/model/terminal-status";
import { BackgroundDialog } from "./background-dialog";
import { AddProjectTile, ProjectTile } from "./project-tile";

export function ProjectsGrid({ onNewTerminal }: { onNewTerminal: (projectId: string) => void }) {
  const {
    projects,
    activeId,
    tabs,
    agentRun,
    cm,
    renaming,
    setRenaming,
    removing,
    setRemoving,
    bgFor,
    setBgFor,
    removeError,
    setRemoveError,
    removePending,
    confirmRemoval,
    menu,
  } = useProjectsGrid({ onNewTerminal });

  return (
    <div class="flex shrink-0 flex-col">
      {/* ~3 rows visible, then the grid scrolls */}
      <ScrollArea
        class="max-h-[232px] px-2 pb-2 pt-2"
        data-testid="projects-grid"
        aria-label="Projects"
      >
        <div class="grid grid-cols-2 gap-1.5">
          {projects.map((p) => {
            const projectTabs = tabs.filter((t) => t.groupId === p.id && !t.kind);
            return (
              <ProjectTile
                key={p.id}
                project={p}
                active={p.id === activeId}
                count={projectTabs.length}
                rollup={rollupState(projectTabs, agentRun)}
                onSelect={() => switchProject(p.id)}
                onRename={() => setRenaming(p)}
                renaming={renaming?.id === p.id}
                onRenameClose={() => setRenaming(null)}
                onContextMenu={(e) => menu(e, p)}
              />
            );
          })}
          <AddProjectTile compact={projects.length % 2 === 0} onClick={requestNewProject} />
        </div>
      </ScrollArea>
      <ContextMenu menu={cm.menu} />
      <ConfirmDialog
        open={!!removing}
        title="Remove project"
        message={`Remove "${removing?.name ?? ""}"? Its terminals, calendar events and scheduled tasks will be removed. The folder on disk is not touched.`}
        error={removeError}
        pending={removePending}
        confirmLabel="Remove"
        onCancel={() => {
          setRemoving(null);
          setRemoveError("");
        }}
        onConfirm={() => void confirmRemoval()}
      />
      <BackgroundDialog
        project={projects.find((p) => p.id === bgFor) ?? null}
        onClose={() => setBgFor(null)}
      />
    </div>
  );
}
