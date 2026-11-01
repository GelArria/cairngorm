import { useCallback, useEffect, useState } from "preact/hooks";
import { type CommitMode, type CommitOptions } from "../data/git-bridge";

import {
  commitMessage,
  getGitState,
  refreshGit,
  stageFiles,
  subscribeGit,
  unstageFiles,
  type GitPanelState,
} from "../data/git-store";
import { startGitWatching } from "../data/git-watcher";
// Hook: subscribe + auto-refresh when the workspace root changes.
export function useGitStatus(): GitPanelState & {
  refresh: () => void;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
  commit: (message: string, mode?: CommitMode, options?: CommitOptions) => Promise<string | null>;
} {
  const [snap, setSnap] = useState<GitPanelState>(getGitState);
  useEffect(() => {
    const stop = subscribeGit(() => setSnap(getGitState()));
    setSnap(getGitState());
    return stop;
  }, []);

  useEffect(startGitWatching, []);

  const refresh = useCallback(() => {
    refreshGit(true);
  }, []);
  const stage = useCallback((paths: string[]) => {
    stageFiles(paths);
  }, []);
  const unstage = useCallback((paths: string[]) => {
    unstageFiles(paths);
  }, []);
  const commit = useCallback(
    (message: string, mode?: CommitMode, options?: CommitOptions) =>
      commitMessage(message, mode, options),
    [],
  );

  return { ...snap, refresh, stage, unstage, commit };
}

export {
  commitMessage,
  getGitState,
  refreshGit,
  stageFiles,
  subscribeGit,
  unstageFiles,
} from "../data/git-store";
export type { GitPanelState } from "../data/git-store";
