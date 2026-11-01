// Wires the active project into the other singletons: terminal groups (one per
// project, cwd = folder), the workspace root (file tree / search) and git.
import {
  adoptUnassignedEvents,
  deleteProjectEvents,
  deleteProjectScheduledTasks,
} from "@/calendar/api";
import { refreshGit } from "@/git/hooks/use-git-status";
import {
  initProjects,
  subscribeProjects,
  type ProjectRecovery,
  type ProjectsState,
} from "@/projects/api";
import { setGlobalSearchRootPath } from "@/search/hooks/use-global-search";
import { loadWorkspace } from "@/terminal/storage";
import { closeGroup, syncProjectGroups } from "@/terminal/workspace";

function recoverProjects(): ProjectRecovery | null {
  const workspace = loadWorkspace();
  if (!workspace) {
    return null;
  }
  return {
    activeId: workspace.activeGroupId,
    projects: workspace.groups
      .filter((group) => group.id !== "g1")
      .map((group) => ({
        id: group.id,
        name: group.name,
        rootPath: typeof group.cwd === "string" ? group.cwd : "",
        color: group.color,
        createdAt: 0,
      })),
  };
}

function apply(s: ProjectsState) {
  if (!s.ready || !s.activeId) {
    return;
  }
  syncProjectGroups(
    s.projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      cwd: p.rootPath || undefined,
    })),
    s.activeId,
  );
  const active = s.projects.find((p) => p.id === s.activeId);
  setGlobalSearchRootPath(active?.rootPath || null);
  refreshGit();
}

let started = false;

/** Main window only (detached terminal windows keep their own group). */
export function startProjectSync(): void {
  if (started) {
    return;
  }
  started = true;
  subscribeProjects(apply);
  initProjects({
    recover: recoverProjects,
    onFirstProject: adoptUnassignedEvents,
    onDelete: closeGroup,
    beforeDelete: async (id) => {
      await deleteProjectScheduledTasks(id);
      await deleteProjectEvents(id);
    },
  }).catch(() => {
    /* in-memory fallback already applied */
  });
}
