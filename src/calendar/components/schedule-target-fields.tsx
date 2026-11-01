import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Label } from "@/common/ui/label";
import type { ScheduleProject, ScheduledTaskInput } from "../data/scheduled-tasks";

export const AGENT_LABELS = {
  cairngorm: "Cairngorm agent",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export function ScheduleTargetFields({
  projects,
  projectId,
  agent,
  setProjectId,
  setAgent,
}: {
  projects: ScheduleProject[];
  projectId: string;
  agent: ScheduledTaskInput["agent"];
  setProjectId: (id: string) => void;
  setAgent: (agent: ScheduledTaskInput["agent"]) => void;
}) {
  const project = projects.find((project) => project.id === projectId);
  return (
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="min-w-0">
        <Label id="schedule-project-label">Project</Label>
        <DropdownMenu
          class="w-full [&>div]:w-full"
          label="Choose project"
          trigger={
            <Button
              variant="outline"
              class="w-full justify-between gap-2"
              aria-labelledby="schedule-project-label"
            >
              <span class="truncate">{project?.name ?? "Choose project"}</span>
              <Icon name="caret-down" />
            </Button>
          }
        >
          {projects
            .filter((project) => project.rootPath)
            .map((project) => (
              <DropdownMenuItem
                key={project.id}
                checked={project.id === projectId}
                onClick={() => setProjectId(project.id)}
              >
                {project.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenu>
      </div>
      <div class="min-w-0">
        <Label id="schedule-agent-label">Agent</Label>
        <DropdownMenu
          class="w-full [&>div]:w-full"
          label="Choose agent"
          trigger={
            <Button
              variant="outline"
              class="w-full justify-between gap-2"
              aria-labelledby="schedule-agent-label"
            >
              {AGENT_LABELS[agent]}
              <Icon name="caret-down" />
            </Button>
          }
        >
          {(["cairngorm", "codex", "gemini"] as const).map((id) => (
            <DropdownMenuItem key={id} checked={id === agent} onClick={() => setAgent(id)}>
              {AGENT_LABELS[id]}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      </div>
      <p class="break-all text-xs text-muted-foreground sm:col-span-2">
        {project?.rootPath || "Choose a project with a folder."}
      </p>
      <p class="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
        Uses the selected agent's configured model at run time. Configure the model and credentials
        in Settings → AI providers. Each run starts a fresh session in this folder.
      </p>
    </div>
  );
}
