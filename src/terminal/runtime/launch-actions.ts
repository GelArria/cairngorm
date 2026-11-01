import type { OpenTabOptions } from "../model/types";
// What can be opened in the terminal area — shared by the empty state's
// buttons and the right-click menus (empty area, tab strip): shells, files,
// the project's Files / Git panels, and the optional Cairngorm agent.
import { openFilePicker, openSidebarModule } from "@/common/events/app-events";
import type { ContextMenuItem } from "@/common/model/context-menu";
import { groups } from "@/common/model/context-menu";
import { catalogProfile, getClis, startProfile } from "../data/cli-launch";
import { getTerminalPreferences } from "../data/terminal-preferences";
import type { DetectedShell } from "../model/types";

export type OpenShell = (options?: OpenTabOptions) => void;

export interface LaunchDeps {
  shells: DetectedShell[];
  onOpen: OpenShell;
  onNewAgent: () => void;
  agentStarting?: boolean;
}

/** Platform shell when detection found nothing */
export const fallbackShell = () =>
  navigator.platform.startsWith("Win") ? "powershell.exe" : "/bin/bash";

export function openShell(d: LaunchDeps, s?: DetectedShell) {
  s ??= getTerminalPreferences().defaultShell ?? undefined;
  if (s) {
    d.onOpen({ shellPath: s.path, shellArgs: s.args, shellEnv: s.env });
  } else {
    d.onOpen({ shellPath: fallbackShell(), shellArgs: [] });
  }
}

export function launchMenu(d: LaunchDeps): ContextMenuItem[] {
  const shellItems: ContextMenuItem[] = d.shells.length
    ? d.shells.map((s) => ({ label: `New ${s.name}`, action: () => openShell(d, s) }))
    : [{ label: "New Terminal", action: () => openShell(d) }];
  return groups(
    shellItems,
    getClis().map((cli) => ({
      label: `New ${cli.name}`,
      action: () => {
        void startProfile(catalogProfile(cli), d.onOpen);
      },
    })),
    getTerminalPreferences().launchProfiles.map((profile) => ({
      label: `New ${profile.name}`,
      action: () => {
        void startProfile(profile, d.onOpen);
      },
    })),
    [{ label: "Open File…", action: openFilePicker }],
    [
      { label: "Show Files", action: () => openSidebarModule("files"), shortcut: "Ctrl+B" },
      { label: "Show Git", action: () => openSidebarModule("git") },
    ],
    [{ label: "New Cairngorm Agent", action: d.onNewAgent, disabled: d.agentStarting }],
  );
}

export interface AgentProblem {
  title: string;
  body: string;
  /** what fixes it */
  fix: "settings" | "retry";
}

/** Turn a raw agent start error into what happened + what to do. */
export function describeAgentError(raw: string): AgentProblem {
  if (/no api key/i.test(raw)) {
    return {
      title: "Choose a provider for the Cairngorm agent",
      body: "Choose a compatible connection in Settings › AI providers → Provider & model, or use the optional verified Codex integration. Then retry. A CLI subscription login is not an API key.",
      fix: "settings",
    };
  }
  if (/cli not found|cairngorm-agent/i.test(raw)) {
    return {
      title: "The Cairngorm agent program is missing",
      body: "Cairngorm couldn't find cairngorm-agent. Reinstall the app — in a dev checkout run “bun run build” in src/agent/core. Terminals remain available.",
      fix: "retry",
    };
  }
  if (/runner|bun|node/i.test(raw) && /not found|no such|cannot find/i.test(raw)) {
    return {
      title: "No runtime for the Cairngorm agent",
      body: "The agent script needs Bun or Node on PATH. Install one, then retry.",
      fix: "retry",
    };
  }
  if (/project changed/i.test(raw)) {
    return {
      title: "The Cairngorm agent wasn't started",
      body: "The active project changed during setup. Retry in the project where you want it to work.",
      fix: "retry",
    };
  }
  return {
    title: "The Cairngorm agent couldn't start",
    body: "Check Settings › AI providers → Provider & model, then retry. Your own CLI agents and terminals remain available.",
    fix: "retry",
  };
}
