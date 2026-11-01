import { openFolderDialog } from "@/common/filesystem/fs-bridge";
import {
  createProject,
  getProjectsState,
  setProjectRoot,
  switchProject,
} from "@/projects/data/project-store";
import type { Project } from "../model/project-types";

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Select the matching project, or create it; launching a shell belongs to the app. */
export function selectProjectFolder(folder: string): { project: Project; created: boolean } {
  const existing = getProjectsState().projects.find(
    (p) => normalize(p.rootPath) === normalize(folder),
  );
  if (existing) {
    switchProject(existing.id);
    return { project: existing, created: false };
  }
  return { project: createProject(folder), created: true };
}

export async function pickProjectFolder(id: string): Promise<void> {
  const folder = await openFolderDialog();
  if (folder) {
    setProjectRoot(id, folder);
  }
}
