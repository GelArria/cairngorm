import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "@/common/errors";
import { getConfig, subscribeConfig } from "@/config";
import { openTab } from "../state/tab-actions";
import { currentState } from "../state/terminal-store";
import {
  profileHosts,
  shellIdentity,
  type DetectedCli,
  type LaunchProfile,
} from "../model/launch-profile";
import { configuredShells } from "./configured-shells";
import { getTerminalPreferences } from "./terminal-preferences";
import type { OpenTabOptions } from "../model/types";

let catalog: DetectedCli[] = [];
let loaded = false;
let pending: Promise<DetectedCli[]> | null = null;
const listeners = new Set<() => void>();
/** Detected CLIs with cairngorm.json's "agentClis" ("hide" by name or id, "add") applied. */
export function getClis(): DetectedCli[] {
  const section = (getConfig().agentClis ?? {}) as { hide?: unknown; add?: unknown };
  const hidden = new Set(
    (Array.isArray(section.hide) ? section.hide : [])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.toLowerCase()),
  );
  const added = (Array.isArray(section.add) ? section.add : []).flatMap((entry): DetectedCli[] => {
    const cli = entry as { id?: unknown; name?: unknown; program?: unknown; args?: unknown };
    if (typeof cli.name !== "string" || typeof cli.program !== "string" || !cli.program.trim()) {
      return [];
    }
    const args = Array.isArray(cli.args)
      ? cli.args.filter((a): a is string => typeof a === "string")
      : [];
    const id = typeof cli.id === "string" && cli.id ? cli.id : `custom-${cli.name.toLowerCase()}`;
    return [{ id, name: cli.name, program: cli.program, args }];
  });
  return [
    ...catalog.filter(
      (cli) => !hidden.has(cli.name.toLowerCase()) && !hidden.has(cli.id.toLowerCase()),
    ),
    ...added,
  ];
}
export function subscribeClis(fn: () => void) {
  listeners.add(fn);
  const stop = subscribeConfig(fn);
  return () => {
    listeners.delete(fn);
    stop();
  };
}
export function scanClis(force = false): Promise<DetectedCli[]> {
  if (pending) {
    return pending;
  }
  if (loaded && !force) {
    return Promise.resolve(catalog);
  }
  pending = invoke<DetectedCli[]>("detect_agent_clis")
    .then((next) => {
      catalog = Array.isArray(next) ? next : [];
      loaded = true;
      listeners.forEach((fn) => fn());
      return next;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
export async function launchProfile(
  profile: LaunchProfile,
  open: (options: OpenTabOptions) => void,
) {
  const groupId = currentState.activeGroupId;
  const resolved = await invoke<{ shellPath: string; shellArgs: string[] }>(
    "resolve_terminal_profile",
    { profile },
  );
  if (currentState.activeGroupId !== groupId) {
    throw new Error("Project changed during launch. Retry in the intended project.");
  }
  // A hosting shell keeps the environment it gets when opened on its own.
  const host = profile.shell && shellIdentity(profile.shell);
  const preferred = getTerminalPreferences().defaultShell;
  const shellEnv = [...(preferred ? [preferred] : []), ...configuredShells()].find(
    (s) => host && shellIdentity(s) === host,
  )?.env;
  open({ ...resolved, ...(shellEnv && { shellEnv }), title: profile.name, isAgent: false });
}

/** Catalog CLIs run inside the default shell, so quitting one leaves that shell open.
 * Without a shell that can host it, the CLI runs on its own. */
export function catalogProfile(cli: DetectedCli): LaunchProfile {
  const preferred = getTerminalPreferences().defaultShell;
  const hosts = profileHosts(configuredShells());
  // The default may be a shell written in cairngorm.json rather than a detected one.
  const host =
    (preferred && profileHosts([preferred])[0]) ?? hosts.find((s) => s.isDefault) ?? hosts[0];
  return { ...cliProfile(cli), shell: host ? { path: host.path, args: [...host.args] } : null };
}
export function startProfile(profile: LaunchProfile, open: (options: OpenTabOptions) => void) {
  return launchProfile(profile, open).catch((e) =>
    window.dispatchEvent(new CustomEvent("terminal-launch-failed", { detail: errorMessage(e) })),
  );
}
const programName = (program: string) =>
  (program.split(/[\\/]/).pop() ?? program).replace(/\.(exe|cmd|ps1|bat)$/i, "");

/** Starts an installed agent CLI in `cwd`, found by id, name or program ("claude",
 * "Claude Code"). Reports a missing CLI the way a failed launch is reported. */
export async function startCliAt(query: string, cwd: string): Promise<void> {
  const wanted = query.toLowerCase();
  const find = () =>
    getClis().find((cli) =>
      [cli.id, cli.name, programName(cli.program)].some((v) => v.toLowerCase() === wanted),
    );
  const cli = find() ?? (await scanClis().catch(() => []), find());
  if (!cli) {
    window.dispatchEvent(
      new CustomEvent("terminal-launch-failed", {
        detail: `No installed agent CLI is called "${query}". Install it, or add it under "agentClis" in cairngorm.json.`,
      }),
    );
    return;
  }
  await startProfile(catalogProfile(cli), (options) => openTab({ ...options, cwd }));
}

export const cliProfile = ({ args = [], ...cli }: DetectedCli): LaunchProfile => ({
  ...cli,
  args,
  shell: null,
});
