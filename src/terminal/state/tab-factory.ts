import { getTerminalPreferences } from "../data/terminal-preferences";
import type { OpenTabOptions } from "../model/types";
import { type TerminalState, type TermTab } from "../model/types";
import { uid } from "./id-counter";
import { currentState } from "./terminal-store";

/** Folder of a group's project — where its new terminals start. */
export function groupCwd(s: TerminalState, groupId: string): string | undefined {
  return s.groups.find((g) => g.id === groupId)?.cwd || undefined;
}

function profileToTitle(profile: string): string {
  const map: Record<string, string> = {
    "code-assistant": "Code",
    "infra-engineer": "Infra",
    "data-analyst": "Data",
    "security-auditor": "Sec",
    "product-strategist": "PM",
  };
  return map[profile] ?? "Terminal";
}

function shellNameFromPath(p: string): string {
  const base = p.replace(/\\/g, "/").split("/").pop() ?? p;
  return base.replace(/\.exe$/i, "");
}

export function createTab({
  profile = "code-assistant",
  title,
  shellPath,
  shellArgs,
  shellEnv,
  isAgent = false,
  sessionId: sessionIdOverride,
  cwd,
}: OpenTabOptions = {}): TermTab {
  const id = uid();
  const preferred = getTerminalPreferences().defaultShell;
  if (!shellPath && !isAgent && preferred) {
    shellPath = preferred.path;
    shellArgs = shellArgs ?? preferred.args;
    shellEnv = { ...preferred.env, ...shellEnv };
  }
  // Agent tabs run the sidecar binary (cairngorm-agent-<target triple>): name them by profile
  const tabTitle =
    title ?? (shellPath && !isAgent ? shellNameFromPath(shellPath) : profileToTitle(profile));
  // First free name in THIS project: "pwsh", "pwsh 2"… (a closed one's name is reused,
  // never a duplicate; other projects and other shells don't count)
  const taken = new Set(
    currentState.tabs
      .filter((t) => (t.groupId ?? "g1") === currentState.activeGroupId)
      .map((t) => t.title),
  );
  let uniqueTitle = tabTitle;
  for (let n = 2; taken.has(uniqueTitle); n++) {
    uniqueTitle = `${tabTitle} ${n}`;
  }
  // Pane counters reset on frontend reload; PTYs may still exist in Rust.
  const sessionId = sessionIdOverride ?? `term-${crypto.randomUUID()}`;
  return {
    id,
    title: uniqueTitle,
    profile,
    shellPath,
    shellArgs,
    shellEnv,
    cwd,
    status: "running",
    sessionId,
    openedAt: Date.now(),
    detached: false,
    isAgent,
  };
}

export function makeChildTab(
  source: TermTab,
  newId: string,
  defaultGroup: string,
  projectCwd?: string,
): TermTab {
  // File source: the split child is a fresh default shell (files don't spawn copies)
  if (source.kind) {
    return {
      ...createTab({ profile: "code-assistant", isAgent: false, cwd: projectCwd }),
      groupId: source.groupId ?? defaultGroup,
    };
  }
  // Fix stale --session-id: replace with new tab's session ID
  const newSessionId = `term-agent-${Date.now()}-${newId}`;
  let fixedArgs = source.shellArgs;
  if (source.isAgent && source.shellArgs) {
    const sidIdx = source.shellArgs.indexOf("--session-id");
    if (sidIdx >= 0 && sidIdx + 1 < source.shellArgs.length) {
      fixedArgs = [...source.shellArgs];
      fixedArgs[sidIdx + 1] = newSessionId;
    }
  }
  const sessionIdOverride = source.isAgent ? newSessionId : undefined;
  return {
    ...createTab({
      profile: source.profile,
      shellPath: source.shellPath,
      shellArgs: fixedArgs,
      shellEnv: source.shellEnv,
      isAgent: source.isAgent,
      sessionId: sessionIdOverride,
      cwd: source.cwd ?? projectCwd,
    }),
    groupId: source.groupId ?? defaultGroup,
  };
}
