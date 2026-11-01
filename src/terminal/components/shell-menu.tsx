import type { OpenTabOptions } from "../model/types";
// "+" in the terminal tab bar: shells first, optional Cairngorm agent last.
import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { useTerminalPreferences } from "@/terminal/hooks/use-terminal-preferences";
import { debugLog } from "../data/terminal-debug-logger";
import { isDefaultShell } from "../data/terminal-preferences";
import type { DetectedShell } from "../model/types";
import { openShell } from "../runtime/launch-actions";
import { shellIdentity } from "../model/launch-profile";
import { AppLaunchItems } from "@/plugins/components/app-launch-items";
import { CliLaunchItems } from "./cli-launch-items";

interface Props {
  shells: DetectedShell[];
  onOpen: (options?: OpenTabOptions) => void;
  onNewAgent: () => void | Promise<void>;
  agentStarting?: boolean;
}

const ITEM = "gap-2 font-sans text-xs";

export function ShellMenu({ shells, onOpen, onNewAgent, agentStarting }: Props) {
  const preferences = useTerminalPreferences();
  return (
    <DropdownMenu
      class="ml-1"
      trigger={
        <Tooltip content="New terminal" shortcut="newTerminalInPane" side="bottom">
          <Button variant="subtle" size="icon-sm" class="text-[13px]" aria-label="New terminal">
            <Icon name="plus" />
          </Button>
        </Tooltip>
      }
    >
      {shells.length === 0 && (
        <DropdownMenuItem class={ITEM} onClick={() => openShell({ shells, onOpen, onNewAgent })}>
          <Icon name="terminal-window" class="text-sm text-muted-foreground" />
          <span>Default shell</span>
        </DropdownMenuItem>
      )}
      {shells.map((s) => (
        <DropdownMenuItem
          key={shellIdentity(s)}
          class={ITEM}
          onClick={() => onOpen({ shellPath: s.path, shellArgs: s.args, shellEnv: s.env })}
        >
          <Icon name="terminal-window" class="text-sm text-muted-foreground" />
          <span>{s.name}</span>
          {isDefaultShell(s, preferences) && (
            <span class="ml-auto pl-3 text-[11px] text-muted-foreground">default</span>
          )}
        </DropdownMenuItem>
      ))}
      <CliLaunchItems onOpen={onOpen} />
      <AppLaunchItems />
      <div class="-mx-1 my-1 h-px bg-border" />
      {agentStarting ? (
        <div role="status" class="px-2 py-1.5 font-sans text-xs text-muted-foreground">
          Starting Cairngorm agent…
        </div>
      ) : (
        <DropdownMenuItem
          class={ITEM}
          onClick={() => {
            Promise.resolve(onNewAgent()).catch((e) =>
              debugLog("terminal-tabs", "spawn-agent-failed", String(e)),
            );
          }}
        >
          <Icon name="sparkle" class="text-sm text-muted-foreground" />
          <span>Cairngorm agent</span>
          <span class="ml-auto pl-3 text-[11px] text-muted-foreground">built-in</span>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
