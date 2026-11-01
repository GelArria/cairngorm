// Shared git state (module singleton, same pattern as use-global-search): one
// snapshot feeds both the toolbar toggle badge and the panel content. Repos are
// resolved from the workspace rootPath (shared source: setGlobalSearchRootPath
// is called by WorkspacePanel on every folder change) — walk-up CWD does not
// exist in the webview, so "workspace outside a repo" shows the no-repo hint.
import { getWorkspaceRootPath } from "@/common/filesystem/workspace-root";
import {
  gitBranch,
  gitCommit,
  gitFileDetails,
  gitLog,
  gitRepoRoot,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitMode,
  type CommitOptions,
  type GitCommit,
  type GitFile,
  type GitFileInfo,
} from "./git-bridge";

export interface GitPanelState {
  root: string | null; // workspace path the snapshot came from
  repo: string | null; // workspace path when it is inside a repo, null = none
  repoRoot: string | null; // real repo root (walk-up) — porcelain paths are relative to it
  branch: string | null;
  files: GitFile[];
  log: GitCommit[];
  details: Record<string, GitFileInfo>; // path → last commit touching it
  error: string | null; // "no-repo" | backend message
  /** The file list is not a successful status result, so an empty list is not "clean". */
  statusFailed: boolean;
  loading: boolean;
}

let state: GitPanelState = {
  root: null,
  repo: null,
  repoRoot: null,
  branch: null,
  files: [],
  log: [],
  details: {},
  error: null,
  statusFailed: false,
  loading: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<GitPanelState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getGitState(): GitPanelState {
  return state;
}

// Load status for the current workspace root. No-op when the root didn't change
// since the last load (panel toggles re-subscribe without re-running git).
let lastRoot: string | null = null;
let refreshSequence = 0;

export async function refreshGit(force = false) {
  const root = getWorkspaceRootPath() ?? "";
  const effective = root || null;
  if (!effective) {
    lastRoot = null;
    refreshSequence++;
    set({
      root: null,
      repo: null,
      repoRoot: null,
      branch: null,
      files: [],
      log: [],
      details: {},
      error: "no-folder",
      statusFailed: false,
      loading: false,
    });
    return;
  }
  if (!force && effective === lastRoot && state.files.length >= 0 && state.repo !== undefined) {
    set({ root: effective });
    return;
  }
  lastRoot = effective;
  const sequence = ++refreshSequence;
  set({
    root: effective,
    loading: true,
    error: null,
    details: {},
    ...(state.root !== effective
      ? { repo: null, repoRoot: null, branch: null, files: [], log: [], statusFailed: false }
      : {}),
  });
  try {
    const [report, branch, repoRoot] = await Promise.all([
      gitStatus(effective),
      gitBranch(effective).catch(() => null),
      gitRepoRoot(effective).catch(() => null),
    ]);
    if (lastRoot !== effective || sequence !== refreshSequence) {
      return;
    }
    const repoErr = report.error === "no-repo";
    const files = report.files ?? [];
    set({
      repo: repoErr ? null : effective,
      repoRoot: repoErr ? null : repoRoot,
      branch: branch || null,
      files,
      error: repoErr ? "no-repo" : (report.error ?? null),
      // A partial report (stderr with parsed files) still lists real changes.
      statusFailed: !repoErr && Boolean(report.error) && files.length === 0,
      loading: false,
      ...(repoErr ? { log: [], details: {} } : {}),
    });
    if (!repoErr) {
      loadLog(effective, sequence);
      loadDetails(effective, sequence);
    }
  } catch (err) {
    if (lastRoot === effective && sequence === refreshSequence) {
      set({ error: String(err), statusFailed: true, loading: false });
    }
  }
}

async function loadLog(root: string, sequence = refreshSequence) {
  try {
    const log = await gitLog(root, 100);
    if (lastRoot === root && sequence === refreshSequence) {
      set({ log });
    }
  } catch {
    if (lastRoot === root && sequence === refreshSequence) {
      set({ log: [] });
    }
  }
}

async function loadDetails(root: string, sequence = refreshSequence) {
  try {
    const map: Record<string, GitFileInfo> = {};
    for (const d of await gitFileDetails(root)) {
      map[d.path] = d;
    }
    if (lastRoot === root && sequence === refreshSequence) {
      set({ details: map });
    }
  } catch {
    if (lastRoot === root && sequence === refreshSequence) {
      set({ details: {} });
    }
  }
}

// Stage/unstage/commit: optimistic-free — each action awaits the backend's fresh
// report and we just replace state with it. Failure surface stays one string.
export async function stageFiles(paths: string[]) {
  const root = state.root;
  if (!root) {
    return;
  }
  try {
    const report = await gitStage(root, paths, paths.length === 0);
    if (state.root === root) {
      set(toState(report));
    }
  } catch (err) {
    if (state.root === root) {
      set({ error: String(err) });
    }
  }
}

export async function unstageFiles(paths: string[]) {
  const root = state.root;
  if (!root) {
    return;
  }
  try {
    const report = await gitUnstage(root, paths, paths.length === 0);
    if (state.root === root) {
      set(toState(report));
    }
  } catch (err) {
    if (state.root === root) {
      set({ error: String(err) });
    }
  }
}

export async function commitMessage(
  message: string,
  mode: CommitMode = "staged",
  options?: CommitOptions,
): Promise<string | null> {
  const root = state.root;
  if (!root) {
    return "No folder open";
  }
  if (!message.trim()) {
    return "Empty message";
  }
  try {
    const report = await gitCommit(root, message, mode, options);
    if (state.root === root) {
      set(toState(report));
      loadLog(root);
    }
    return report.error;
  } catch (err) {
    return String(err);
  }
}

// A failed action (commit hook, missing user.email…) comes back with an error
// and an EMPTY file list — keep the current list (and whether it is known) instead of
// blanking the panel. Any other report carries a fresh status.
function toState(report: { files?: GitFile[]; error?: string | null }): Partial<GitPanelState> {
  const files = report.files ?? [];
  if (report.error && files.length === 0) {
    return { error: report.error };
  }
  return { files, error: report.error ?? null, statusFailed: false };
}

/** Plain subscription (non-hook consumers, e.g. the file tree's git marks). */
export function subscribeGit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
