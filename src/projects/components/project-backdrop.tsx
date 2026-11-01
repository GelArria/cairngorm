// Backdrop layer of a project card: the stone's facet-lit gradient, the user's
// image, or nothing. Absolutely fills its (relative) parent.
import { useBackgroundImage } from "@/projects/hooks/use-background-image";
import { parseBackground, projectStone, stoneBackdrop } from "@/projects/model/project-backgrounds";
import type { Project } from "../model/project-types";

export function ProjectBackdrop({ project }: { project: Pick<Project, "id" | "background"> }) {
  const bg = parseBackground(project);
  const img = useBackgroundImage(bg.kind === "image" ? bg.path : null);
  const background =
    bg.kind === "none"
      ? "hsl(var(--secondary))"
      : bg.kind === "image"
        ? img
          ? `url("${img}") center / cover no-repeat`
          : "linear-gradient(160deg, #17181c, #0c0d10)"
        : stoneBackdrop(projectStone(project).color);
  return (
    <span aria-hidden="true" class="pointer-events-none absolute inset-0" style={{ background }} />
  );
}
