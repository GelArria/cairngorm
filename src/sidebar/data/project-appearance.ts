import { DEFAULT_CUT } from "@/common/branding/gem-cuts";
import { openImageDialog } from "@/common/filesystem/fs-bridge";
import { setProjectBackground, setProjectColor, setProjectCut, type Project } from "@/projects/api";
import { forgetBackgroundImage, gemYaw, parseBackground, projectStone } from "@/projects/visuals";

export function projectAppearanceActions(project: Project) {
  const setBg = (background: string | null) => setProjectBackground(project.id, background);
  return {
    current: parseBackground(project),
    stone: projectStone(project),
    cut: project.cut ?? DEFAULT_CUT,
    yaw: gemYaw(project.id),
    setBg,
    selectStone(id: string) {
      setProjectColor(project.id, null);
      setBg(`preset:${id}`);
    },
    selectCut(id: string) {
      setProjectCut(project.id, id === DEFAULT_CUT ? null : id);
    },
    reset() {
      setBg(null);
      setProjectCut(project.id, null);
      setProjectColor(project.id, null);
    },
    async pickImage() {
      const path = await openImageDialog();
      if (path) {
        forgetBackgroundImage(path);
        setBg(`image:${path}`);
      }
    },
  };
}
