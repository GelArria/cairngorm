import { useEffect, useState } from "preact/hooks";
import {
  gitPendingOperation,
  gitRemoteStatus,
  gitRemotes,
  gitSync,
  type GitRemoteStatus,
  type SyncAction,
} from "../data/git-bridge";
import type { useGitStatus } from "./use-git-status";

type Pending = Awaited<ReturnType<typeof gitPendingOperation>>;

/** Remote state (ahead/behind, upstream, remotes), a pending history operation and push/pull. */
export function useGitSync(
  git: ReturnType<typeof useGitStatus>,
  busy: boolean,
  setBusy: (v: boolean) => void,
  onError: (v: string | null) => void,
) {
  const [snapshot, setSnapshot] = useState<{
    root: string;
    branch: string | null;
    status: GitRemoteStatus | null;
    remotes: string[];
    pending: Pending;
  } | null>(null);
  const [running, setRunning] = useState<SyncAction | null>(null);
  // Outside a repository (or with a status error) there is nothing to ask the remotes.
  const usable = !!git.root && !!git.repo && !git.error;
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    if (git.root && usable && !git.loading) {
      const root = git.root,
        branch = git.branch;
      void Promise.allSettled([
        gitRemoteStatus(root),
        gitRemotes(root),
        gitPendingOperation(root),
      ]).then(([status, remotes, pending]) => {
        if (!active) {
          return;
        }
        setSnapshot({
          root,
          branch,
          status: status.status === "fulfilled" ? status.value : null,
          remotes: remotes.status === "fulfilled" ? remotes.value : [],
          // Optional: older backends or a failed read just hide Continue / Abort.
          pending: pending.status === "fulfilled" ? pending.value : null,
        });
        if (status.status === "rejected") {
          onError(String(status.reason));
        } else if (remotes.status === "rejected") {
          onError(String(remotes.reason));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [git.root, git.branch, git.loading, git.log, usable]);

  const current =
    snapshot?.root === git.root && snapshot?.branch === git.branch && !git.loading
      ? snapshot
      : null;
  async function sync(action: SyncAction, remote?: string) {
    if (!git.root || busy || git.loading) {
      return;
    }
    setBusy(true);
    setRunning(action);
    onError(null);
    try {
      await gitSync(git.root, action, remote);
    } catch (err) {
      onError(String(err));
    } finally {
      git.refresh();
      setBusy(false);
      setRunning(null);
    }
  }
  return {
    status: current?.status ?? null,
    remotes: current?.remotes ?? [],
    pending: current?.pending ?? null,
    /** The sync action in flight, so only its own control spins. */
    running,
    sync,
  };
}

export type GitSyncState = ReturnType<typeof useGitSync>;
