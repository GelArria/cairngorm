import { CairngormGem } from "@/common/branding/";
import { useProjects } from "../hooks/use-projects";
import { gemYaw, projectStone } from "../model/project-backgrounds";
import { ProjectGem } from "./project-gem";

/** A silent loading state that retains the owning project's identity. */
export function ProjectLoader({ projectId }: { projectId?: string }) {
  const { projects, activeId } = useProjects();
  const project = projects.find((p) => p.id === (projectId ?? activeId));
  return (
    <div
      role="status"
      aria-label="Loading terminal"
      class="flex h-full w-full items-center justify-center"
    >
      {project ? (
        <ProjectGem
          color={projectStone(project).color}
          cut={project.cut}
          yaw={gemYaw(project.id)}
          size={96}
          spin
        />
      ) : (
        <CairngormGem size={96} />
      )}
    </div>
  );
}
