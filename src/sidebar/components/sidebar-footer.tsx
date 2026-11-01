// Sidebar status bar: one inset bar with the collapse toggle (centred where the rail's
// toggle sits), the branch with its change count, and the agent-running dot.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import type { GitPanelState } from "@/git/hooks/use-git-status";
import { useActiveProject } from "@/projects/api";
import { projectStone } from "@/projects/visuals";
import { useAgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import type { SidebarSide } from "../../common/layout/sidebar-side";
import { SidebarToggle } from "./sidebar-toggle";

export function SidebarFooter({
  side,
  onCollapse,
  git,
  onOpenGit,
}: {
  side: SidebarSide;
  onCollapse: () => void;
  git: GitPanelState;
  onOpenGit: () => void;
}) {
  const running = Object.values(useAgentRunStatus()).includes("running");
  const project = useActiveProject();
  const accent = project ? projectStone(project).color : "#d9c4a8";
  // Backend status is capped at 500 entries: at the cap, only claim a lower bound.
  const capped = git.files.length >= 500;
  const count = `${capped ? "≥" : ""}${git.files.length}`;
  const description = `${capped ? "at least " : ""}${git.files.length} changed files${capped ? " (display limit)" : ""}`;
  return (
    // 6px side inset + a 32px toggle centres it on the 44px rail's toggle: « and » never
    // jump. The branch lines up with neighbouring panes' footers (Tests view).
    <div class="shrink-0 px-1.5 pb-1 pt-1">
      <div
        class={`flex h-8 items-center gap-0.5 rounded-[10px] border border-border bg-background ${side === "right" ? "flex-row-reverse" : ""}`}
      >
        <SidebarToggle side={side} collapsed={false} onToggle={onCollapse} compact />
        {git.repo && git.branch && (
          <Tooltip
            content={`Open Git · ${description}`}
            shortcut="openGit"
            class="flex h-full min-w-0 flex-1 py-1"
          >
            <Button
              variant="subtle"
              size="xs"
              data-testid="git-footer"
              onClick={onOpenGit}
              class="h-full min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1.5 font-mono text-[11px] text-muted-foreground"
              aria-label={`Open Git: ${git.branch}, ${description}`}
            >
              <Icon name="git-branch" class="shrink-0" />
              <span class="truncate">{git.branch}</span>
              {/* Only changes are news: a clean tree shows just the branch. */}
              {git.files.length > 0 && (
                <span
                  class="ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-4 tabular-nums text-foreground"
                  style={{
                    background: `color-mix(in srgb, ${accent} 22%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)`,
                  }}
                >
                  {count} Δ
                </span>
              )}
            </Button>
          </Tooltip>
        )}
        {running && (
          <span
            class="flex h-full items-center px-2"
            title="Agent running"
            aria-label="Agent running"
          >
            <span class="h-[5px] w-[5px] rounded-full bg-amber-400 motion-safe:animate-pulse" />
          </span>
        )}
      </div>
    </div>
  );
}
