import { ContextMenu } from "@/common/components/context-menu";
// Empty workspace: shells and files first; the Cairngorm agent is optional.
// Right-click anywhere opens the same launch menu.
import { openFilePicker } from "@/common/events/app-events";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { useActiveProject } from "@/projects/api";
import { gemYaw, ProjectGem, projectStone } from "@/projects/visuals";
import { useTerminalPreferences } from "@/terminal/hooks/use-terminal-preferences";
import { isDefaultShell } from "../data/terminal-preferences";
import { shellIdentity } from "../model/launch-profile";
import { launchMenu, openShell, type LaunchDeps } from "../runtime/launch-actions";
import { AgentLaunchNotice } from "./agent-launch-notice";

export type InitStatus = "loading" | "ready" | "error";

interface Props extends LaunchDeps {
  status: InitStatus;
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}

const ROW = "h-8 w-full justify-start gap-2.5 px-2.5 text-xs font-normal";

export function TerminalEmptyState({ status, error, onRetry, onDismiss, ...launch }: Props) {
  const project = useActiveProject();
  const preferences = useTerminalPreferences();
  const cm = useContextMenu();
  const stone = project ? projectStone(project) : null;

  return (
    <div
      class="flex h-full items-center justify-center overflow-y-auto bg-background surface-panel p-6"
      data-testid="terminal-empty"
      onContextMenu={(e) => cm.open(e, launchMenu(launch))}
    >
      <div class="flex w-full max-w-[320px] flex-col gap-4 font-sans">
        <div class="flex items-center gap-3">
          {project && stone && (
            <ProjectGem
              color={stone.color}
              cut={project.cut}
              yaw={gemYaw(project.id)}
              size={44}
              spin
              fps={20}
            />
          )}
          {/* The empty pane already says nothing is open; the folder is in the tooltip. */}
          <p
            class="min-w-0 truncate text-sm font-semibold text-foreground"
            title={project?.rootPath}
          >
            {project?.name ?? "No project"}
          </p>
        </div>

        {status === "loading" && (
          <p role="status" class="px-2.5 text-xs text-muted-foreground">
            Starting the Cairngorm agent…
          </p>
        )}
        {status === "error" && (
          <AgentLaunchNotice error={error} onRetry={onRetry} onDismiss={onDismiss} />
        )}

        <div class="flex flex-col" data-testid="launch-list">
          {(launch.shells.length ? launch.shells : [undefined]).map((s) => (
            <Tooltip
              key={s ? shellIdentity(s) : "default"}
              content={`New ${s?.name ?? "terminal"}`}
              shortcut={!s || isDefaultShell(s, preferences) ? "newTerminalInPane" : undefined}
              class="flex w-full"
            >
              <Button variant="ghost" class={ROW} onClick={() => openShell(launch, s)}>
                <Icon name="terminal-window" class="text-sm text-muted-foreground" />
                <span class="flex-1 truncate text-left">{s?.name ?? "Terminal"}</span>
                {s && isDefaultShell(s, preferences) && (
                  <span class="text-[11px] text-muted-foreground">default</span>
                )}
              </Button>
            </Tooltip>
          ))}
          <Tooltip content="Open file" shortcut="openFile" class="flex w-full">
            <Button variant="ghost" class={ROW} onClick={openFilePicker}>
              <Icon name="file" class="text-sm text-muted-foreground" />
              <span class="flex-1 text-left">Open file…</span>
            </Button>
          </Tooltip>
          <p class="px-2.5 py-1 text-[11px] text-muted-foreground">
            Run Claude Code, Codex or another CLI in a terminal, or use Cairngorm's own agent (set
            up in Settings › AI providers).
          </p>
          <Tooltip content="New Cairngorm agent" shortcut="newAgent" class="flex w-full">
            <Button
              variant="ghost"
              class={ROW}
              onClick={launch.onNewAgent}
              disabled={status === "loading"}
            >
              <Icon name="sparkle" class="text-sm text-muted-foreground" />
              <span class="flex-1 text-left">Cairngorm agent</span>
              <span class="text-[11px] text-muted-foreground">built-in</span>
            </Button>
          </Tooltip>
          <p class="mt-2 px-2.5 text-[11px] text-muted-foreground">
            Right-click here for Files and Git too.
          </p>
        </div>
      </div>
      <ContextMenu menu={cm.menu} />
    </div>
  );
}
