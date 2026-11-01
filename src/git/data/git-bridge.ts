// Thin invoke wrappers for the git_* Tauri commands (src/git/native/git.rs).
// Pure data — no state here; the panel owns state, this is just the wire format.

export interface GitFile {
  path: string; // "/"-separated, relative to repo root
  code: string; // porcelain status code (XY or "??")
}

export interface GitReport {
  files: GitFile[];
  error: string | null; // "no-repo" | message, panel decides how to show it
}

export interface GitCommit {
  hash: string;
  author: string;
  email?: string;
  time: string; // git %ar ("2 hours ago")
  subject: string;
  parents?: string[]; // abbreviated parent hashes, 2+ = merge
  refs?: string[]; // "HEAD -> main", "origin/main", "feat/x"
  at?: number; // unix seconds
}

export interface GitCommitFile {
  path: string;
  oldPath?: string | null;
  status: string;
  added: number | null;
  removed: number | null;
}
export interface GitCommitDetails {
  hash: string;
  author: string;
  email: string;
  date: string;
  refs: string[];
  message: string;
  files: GitCommitFile[];
  parents?: string[];
  githubUrl?: string | null;
}
export async function gitCommitDetails(root: string, hash: string): Promise<GitCommitDetails> {
  return (await getInvoke())("git_commit_details", { root, hash });
}
export async function gitCommitDiff(
  root: string,
  hash: string,
  file: GitCommitFile,
): Promise<string> {
  return (await getInvoke())("git_commit_diff", {
    root,
    hash,
    path: file.path,
    oldPath: file.oldPath ?? null,
  });
}

export interface GitFileInfo {
  path: string;
  hash: string;
  author: string;
  email: string;
  at: number; // unix epoch seconds of the last commit touching this path
  subject: string;
}

// Abbreviated age: "now", "5m", "3h", "2d", "1w", "4mo", "1y"
export function relTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at * 1000) / 1000));
  const units: [number, string][] = [
    [60, "now"],
    [3600, "m"],
    [86400, "h"],
    [604800, "d"],
    [2592000, "w"],
    [31536000, "mo"],
  ];
  for (let i = 0; i < units.length; i++) {
    if (s < units[i][0]) {
      if (i === 0) {
        return "now";
      }
      return `${Math.floor(s / units[i - 1][0])}${units[i][1]}`;
    }
  }
  return `${Math.floor(s / 31536000)}y`;
}

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

const CODE_MAP: Record<string, GitFileStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "?": "untracked",
  U: "conflicted",
};

// porcelain: "?? " untracked, "M " staged, " M" unstaged, "MM" both…
export function classify(code: string): GitFileStatus {
  const x = code[0] ?? " ",
    y = code[1] ?? " ";
  if (x === "?" && y === "?") {
    return "untracked";
  }
  if (x === "U" || y === "U") {
    return "conflicted";
  }
  return CODE_MAP[x !== " " ? x : y] ?? "modified";
}

async function getInvoke(): Promise<typeof import("@tauri-apps/api/core").invoke> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  } catch {
    const fallback =
      (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.invoke;
    if (fallback) {
      return fallback;
    }
    throw new Error("Tauri API not available");
  }
}

export async function gitStatus(root: string): Promise<GitReport> {
  return (await (
    await getInvoke()
  )("git_status", { root })) as GitReport;
}

export async function gitStage(root: string, paths: string[], all: boolean): Promise<GitReport> {
  return (await (
    await getInvoke()
  )("git_stage", { root, paths, all })) as GitReport;
}

export async function gitUnstage(root: string, paths: string[], all: boolean): Promise<GitReport> {
  return (await (
    await getInvoke()
  )("git_unstage", { root, paths, all })) as GitReport;
}

export type CommitMode = "staged" | "tracked" | "all";

export interface CommitOptions {
  amend: boolean;
  signoff: boolean;
  skipHooks: boolean;
}
export async function gitCommit(
  root: string,
  message: string,
  mode: CommitMode = "staged",
  options?: CommitOptions,
): Promise<GitReport> {
  return (await (
    await getInvoke()
  )("git_commit", { root, message, mode, ...(options ? { options } : {}) })) as GitReport;
}

export interface GitRemoteStatus {
  ahead: number;
  behind: number;
  remote: string | null;
  upstream: boolean;
}
export async function gitRemoteStatus(root: string): Promise<GitRemoteStatus> {
  return (await getInvoke())("git_remote_status", { root });
}
/** A cherry-pick or revert waiting for Continue / Abort, if any. */
export async function gitPendingOperation(root: string): Promise<"cherry-pick" | "revert" | null> {
  return (await getInvoke())("git_pending_operation", { root });
}

export type SyncAction =
  | "pull"
  | "fetch"
  | "push"
  | "push-upstream"
  | "publish"
  | "pull-rebase"
  | "force-push";
export async function gitSync(root: string, action: SyncAction, remote?: string): Promise<void> {
  await (
    await getInvoke()
  )("git_sync", { root, action, ...(remote ? { remote } : {}) });
}
export async function gitRemotes(root: string): Promise<string[]> {
  return (await getInvoke())("git_remotes", { root });
}

export async function gitBranches(root: string): Promise<string[]> {
  return (await getInvoke())("git_branches", { root });
}

export async function gitSwitch(root: string, branch: string, create = false): Promise<void> {
  await (
    await getInvoke()
  )("git_switch", { root, branch, create });
}

export type CommitAction =
  | "cherry-pick"
  | "revert"
  | "cherry-pick-continue"
  | "cherry-pick-abort"
  | "revert-continue"
  | "revert-abort";
export async function gitCommitAction(
  root: string,
  action: CommitAction,
  hash?: string,
): Promise<void> {
  await (
    await getInvoke()
  )("git_commit_action", { root, action, hash });
}

export async function gitSummarize(root: string, mode: CommitMode): Promise<string> {
  return (await getInvoke())("git_summarize", { root, mode });
}

/** Repo root the folder resolves to (walking up), null outside a repo. */
export async function gitRepoRoot(root: string): Promise<string | null> {
  return (await (
    await getInvoke()
  )("git_repo_root", { root })) as string | null;
}

export async function gitBranch(root: string): Promise<string> {
  return (await (
    await getInvoke()
  )("git_branch", { root })) as string;
}

export async function gitLog(root: string, max: number, skip = 0): Promise<GitCommit[]> {
  return (await (
    await getInvoke()
  )("git_log", { root, max, skip })) as GitCommit[];
}

export async function gitFileDetails(root: string): Promise<GitFileInfo[]> {
  return (await (
    await getInvoke()
  )("git_file_details", { root })) as GitFileInfo[];
}

export type DiffKind = "staged" | "unstaged" | "untracked";

export async function gitDiff(root: string, path: string, kind: DiffKind): Promise<string> {
  return (await (
    await getInvoke()
  )("git_diff", { root, path, kind })) as string;
}
