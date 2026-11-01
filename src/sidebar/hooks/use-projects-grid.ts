import { toggleFrozen, useSystemMotion } from "@/appearance/data/motion-preferences";
import { useGemDisplay } from "@/appearance/hooks/use-gem-display";
import { errorMessage } from "@/common/errors";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { colorItem, groups as menuGroups } from "@/common/model/context-menu";
import {
  pickProjectFolder,
  removeProject,
  setProjectColor,
  useProjects,
  type Project,
} from "@/projects/index";
import { useAgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { useTerminalGroups } from "@/terminal/workspace";
import { useState } from "preact/hooks";

export function useProjectsGrid({ onNewTerminal }: { onNewTerminal: (projectId: string) => void }) {
  const { projects, activeId } = useProjects();
  const { tabs } = useTerminalGroups();
  const agentRun = useAgentRunStatus();
  const cm = useContextMenu();
  const display = useGemDisplay();
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [bgFor, setBgFor] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [removePending, setRemovePending] = useState(false);
  const confirmRemoval = async () => {
    if (!removing || removePending) {
      return;
    }
    setRemovePending(true);
    setRemoveError("");
    try {
      if (await removeProject(removing.id)) {
        setRemoving(null);
      } else {
        setRemoveError("This project cannot be removed right now.");
      }
    } catch (error) {
      setRemoveError(errorMessage(error));
    } finally {
      setRemovePending(false);
    }
  };

  const menu = (e: MouseEvent, p: Project) =>
    cm.open(
      e,
      menuGroups(
        [{ label: "New Terminal", action: () => onNewTerminal(p.id) }],
        [
          { label: "Rename…", action: () => setRenaming(p) },
          { label: "Change Folder…", action: () => pickProjectFolder(p.id) },
          { label: "Change Appearance…", action: () => setBgFor(p.id) },
        ],
        [colorItem(p.color, (c) => setProjectColor(p.id, c))],
        // Gem rotation toggles live here too
        [
          {
            label: display.frozen ? "Unfreeze 3D Rotation" : "Freeze 3D Rotation",
            action: toggleFrozen,
          },
          ...(display.forceMotion
            ? [{ label: "Use System Motion Setting", action: useSystemMotion }]
            : []),
        ],
        [
          {
            label: "Remove Project…",
            danger: true,
            disabled: projects.length <= 1,
            action: () => setRemoving(p),
          },
        ],
      ),
    );
  return {
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
  };
}
