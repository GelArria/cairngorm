import { ContextMenu } from "@/common/components/context-menu";
// Collapsed rail (44px) — the expanded sidebar's structure in miniature:
// 1. every project as its gem (stone colour + cut); the selected one is lit
// 2. the selected project's modules (Calendar · Files · Git), lit in
//    its stone colour — each module expands the sidebar into its panel
// 3. the selected project's terminals (index + agent status)
// Clicking a project or terminal never expands the rail (accidental clicks did);
// the » toggle and module buttons are the ways to open it.
import { useProjectAccent } from "@/appearance/model/project-accent";
import { requestNewProject } from "@/common/events/app-events";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups } from "@/common/model/context-menu";
import { Tooltip } from "@/common/ui/tooltip";
import { switchProject, useProjects } from "@/projects/index";
import { gemYaw, ProjectGem, projectStone } from "@/projects/visuals";
import { useAgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { innerSide, type SidebarSide } from "../../common/layout/sidebar-side";
import { useTerminalGroups } from "../../terminal/workspace";
import { MODULES, type ModuleId, type ProjectModule } from "./project-modules";
import { SidebarToggle } from "./sidebar-toggle";
import { StatusDot } from "./terminal-status";

interface Props {
  side: SidebarSide;
  onExpand: () => void;
  /** Module open in the (hidden) sidebar — null = terminal list. */
  open: ProjectModule | null;
  onModule: (m: ModuleId) => void;
  gitChanges: number;
}

const showGrid = () => window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));

export function SidebarCollapsedRail({ side, onExpand, open, onModule, gitChanges }: Props) {
  const { projects, activeId } = useProjects();
  const { tabs, activeTabId, setActiveTab, closeTab, restartTab } = useTerminalGroups();
  const tip = innerSide(side);
  const cm = useContextMenu();
  const agentRun = useAgentRunStatus();
  const active = projects.find((p) => p.id === activeId);
  const accent = active ? projectStone(active).color : "#d9c4a8";
  const uiAccent = useProjectAccent(accent);
  const own = tabs.filter((t) => t.groupId === activeId && !t.kind);
  const focus = (tabId: string) => {
    setActiveTab(tabId);
    showGrid();
  };

  return (
    <div
      data-testid="sidebar-collapsed"
      class="flex h-full w-11 flex-col items-center"
      onContextMenu={(e) =>
        cm.open(e, [{ label: "New Project…", action: () => requestNewProject() }])
      }
    >
      {/* 1 · projects */}
      <div
        class="flex max-h-[40%] w-full flex-col items-center gap-1 overflow-y-auto py-2"
        role="group"
        aria-label="Projects"
      >
        {projects.map((p) => {
          const stone = projectStone(p);
          const on = p.id === activeId;
          return (
            <Tooltip key={p.id} content={p.name} side={tip}>
              <button
                type="button"
                data-testid={`rail-project-${p.id}`}
                aria-label={p.name}
                aria-current={on ? "true" : undefined}
                class={`group flex h-8 w-8 items-center justify-center rounded-lg border outline-none transition-[opacity,background-color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring ${
                  on ? "" : "border-transparent opacity-70 hover:opacity-100"
                }`}
                style={
                  on
                    ? { borderColor: `${stone.color}88`, background: `${stone.color}1a` }
                    : undefined
                }
                onClick={() => switchProject(p.id)}
              >
                <ProjectGem
                  color={stone.color}
                  cut={p.cut}
                  yaw={gemYaw(p.id)}
                  size={26}
                  spin={on}
                  fps={20}
                />
              </button>
            </Tooltip>
          );
        })}
        <Tooltip content="New project" side={tip}>
          <button
            type="button"
            aria-label="New project"
            class="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            onClick={() => requestNewProject()}
          >
            +
          </button>
        </Tooltip>
      </div>
      <i class="h-px w-5 shrink-0 bg-border" />
      {/* 2 · selected project's modules */}
      <div class="flex flex-col items-center gap-1 py-2" role="group" aria-label="Project modules">
        {MODULES.map(({ id, label, icon: I, shortcut }) => {
          const on = open === id;
          const badge = id === "git" && gitChanges > 0;
          return (
            <Tooltip
              key={id}
              content={badge ? `${label} · ${gitChanges} changed` : label}
              shortcut={shortcut}
              side={tip}
            >
              <button
                type="button"
                data-testid={`rail-${id}`}
                aria-label={label}
                aria-pressed={on}
                class={`group relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${on ? "" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                style={
                  on
                    ? {
                        color: uiAccent,
                        background: `${accent}1f`,
                        boxShadow: `inset 0 0 0 1px ${accent}55`,
                      }
                    : undefined
                }
                onClick={() => onModule(id)}
              >
                <I class="text-[15px] transition-transform duration-200 group-hover:-translate-y-px" />
                {badge && (
                  <b
                    class="absolute right-[3px] top-[3px] h-[6px] w-[6px] rounded-full"
                    style={{ background: accent, boxShadow: "0 0 0 2px hsl(var(--card))" }}
                  />
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <i class="h-px w-5 shrink-0 bg-border" />
      {/* 3 · selected project's terminals */}
      <div class="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto py-2">
        {own.map((t, i) => (
          <Tooltip key={t.id} content={t.title} side={tip}>
            <button
              type="button"
              data-testid={`rail-term-${t.id}`}
              aria-label={t.title}
              class={`flex h-[26px] items-center gap-1.5 rounded-md px-1.5 ${t.id === activeTabId ? "" : "hover:bg-accent/50"}`}
              style={t.id === activeTabId ? { background: `${accent}1a` } : undefined}
              onClick={() => focus(t.id)}
              onContextMenu={(e) =>
                cm.open(
                  e,
                  groups(
                    [
                      { label: "Focus", action: () => focus(t.id) },
                      { label: "Restart", action: () => restartTab(t.id), disabled: t.detached },
                    ],
                    [{ label: "Close Terminal", danger: true, action: () => closeTab(t.id) }],
                  ),
                )
              }
            >
              <span
                class="w-2 text-right font-mono text-[9px] text-muted-foreground/70"
                style={t.id === activeTabId ? { color: uiAccent } : undefined}
              >
                {i + 1}
              </span>
              <span class="flex w-1.5 justify-center">
                <StatusDot tab={t} agentRun={agentRun[t.sessionId]} />
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
      <ContextMenu menu={cm.menu} />
      {/* Same cell as the expanded footer's « — the toggle never moves */}
      <div class="flex h-[30px] w-full shrink-0 items-center border-t border-border">
        <SidebarToggle side={side} collapsed onToggle={onExpand} />
      </div>
    </div>
  );
}
