// Data/state interface. Visual components have a separate entry point.
export {
  createProject,
  getActiveProject,
  getProjectsState,
  initProjects,
  removeProject,
  renameProject,
  setProjectBackground,
  setProjectColor,
  setProjectCut,
  setProjectRoot,
  subscribeProjects,
  switchProject,
  whenProjectsReady,
} from "@/projects/data/project-store";
export type { ProjectsState } from "@/projects/data/project-store";
export { pickProjectFolder, selectProjectFolder } from "./data/project-folders";
export { useActiveProject, useActiveProjectId, useProjects } from "./hooks/use-projects";
export { folderName } from "./model/project-types";
export type { Project, ProjectLifecycle, ProjectRecovery } from "./model/project-types";
