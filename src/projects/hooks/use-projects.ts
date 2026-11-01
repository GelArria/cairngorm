import { type Project } from "@/projects/model/project-types";
import { useEffect, useState } from "preact/hooks";
import { getProjectsState, subscribeProjects, type ProjectsState } from "../data/project-store";

export function useProjects(): ProjectsState {
  const [snap, setSnap] = useState(getProjectsState());
  useEffect(() => {
    setSnap(getProjectsState());
    return subscribeProjects(setSnap);
  }, []);
  return snap;
}

export function useActiveProject(): Project | null {
  const s = useProjects();
  return s.projects.find((p) => p.id === s.activeId) ?? null;
}

/** Subscribe only to selection changes, without re-rendering on project appearance edits. */
export function useActiveProjectId(): string | null {
  const [id, setId] = useState(getProjectsState().activeId);
  useEffect(() => {
    setId(getProjectsState().activeId);
    return subscribeProjects((s) => setId(s.activeId));
  }, []);
  return id;
}
