// One terminal under a sidebar group, as a three-line card:
//   [n] workspace folder ··············· time in current state
//   Terminal title (semibold)
//   ⑂ branch (or shell profile) ················ status glyph
// Settled terminals (not running) dim their title; the focused one is a filled card.
import { BotIcon, TerminalIcon } from "@/common/ui/animated-icon";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { type AgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { dotState } from "@/sidebar/model/terminal-status";
import type { TermTab } from "../../terminal/types";
import { Elapsed } from "./elapsed";
import { StatusDot, StatusGlyph } from "./terminal-status";

interface Props {
  tab: TermTab;
  groupId: string;
  index: number;
  active: boolean;
  compact?: boolean;
  agentRun?: AgentRunStatus;
  folder: string;
  branch: string | null;
  onFocus: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

function KindIcon({ tab }: { tab: TermTab }) {
  if (tab.kind === "file") {
    return <Icon name="file-text" class="text-[12px]" />;
  }
  return tab.isAgent ? <BotIcon class="text-[12px]" /> : <TerminalIcon class="text-[12px]" />;
}

export function TerminalRow({
  tab,
  groupId,
  index,
  active,
  compact = false,
  agentRun,
  folder,
  branch,
  onFocus,
  onContextMenu,
}: Props) {
  const state = dotState(tab, agentRun);
  // dim only an agent that is not working; a live shell reads as active
  const settled = state === "available" || state === "done";
  const detail = branch ?? tab.profile;
  if (compact) {
    return (
      <Button
        variant="subtle"
        size="sm"
        class="h-10 max-w-[220px] shrink-0 gap-2 rounded-lg border border-transparent px-3 aria-pressed:border-border"
        data-testid={`dock-term-${tab.id}`}
        aria-pressed={active}
        aria-label={`${tab.title} — ${state}`}
        title={`${folder || tab.profile} · ${detail} · ${state}`}
        onClick={onFocus}
        onContextMenu={onContextMenu}
      >
        <span class="font-mono text-[11px] text-muted-foreground">{index}</span>
        <KindIcon tab={tab} />
        <span class="truncate">{tab.title}</span>
        <StatusDot tab={tab} agentRun={agentRun} />
      </Button>
    );
  }
  return (
    <div class="flex w-full">
      <div
        data-testid={`term-${groupId}-${tab.id}`}
        class={`group mx-1.5 my-0.5 flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors ${
          active ? "bg-accent" : "hover:bg-secondary"
        }`}
        onClick={onFocus}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
        aria-current={active || undefined}
        aria-label={`${tab.title} — ${state}`}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).click();
          }
        }}
      >
        <div class="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] bg-background/60 px-1 font-mono text-[9px] font-semibold tabular-nums text-foreground/80 ring-1 ring-border">
            {index}
          </span>
          <KindIcon tab={tab} />
          <span class="truncate">{folder || tab.profile}</span>
          <span class="ml-auto flex shrink-0 items-center gap-1 pl-2 tabular-nums text-muted-foreground/75">
            {tab.detached && <Icon name="arrow-square-out" class="text-[11px]" />}
            {!tab.detached && <Elapsed tabId={tab.id} />}
          </span>
        </div>
        <span
          class={`truncate text-[14px] font-semibold leading-5 ${settled && !active ? "text-foreground/55" : "text-foreground"}`}
        >
          {tab.title}
        </span>
        <div class="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/75">
          {branch && <Icon name="git-branch" class="text-[11px]" />}
          <span class="truncate">{tab.detached ? `detached · ${detail}` : detail}</span>
          <span class="ml-auto flex h-4 w-4 shrink-0 items-center justify-center">
            <StatusGlyph state={state} />
          </span>
        </div>
      </div>
    </div>
  );
}
