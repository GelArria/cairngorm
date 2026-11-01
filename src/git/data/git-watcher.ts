import { getWorkspaceRootPath } from "@/common/filesystem/workspace-root";
import { getGitState, refreshGit } from "./git-store";
let watchers = 0;
let stopWatching: (() => void) | null = null;
/** Share one polling source across all Git subscribers. */
export function startGitWatching(): () => void {
  if (++watchers === 1) {
    void refreshGit();
    let ticks = 0;
    const focus = () => {
      if (!getGitState().loading) {
        void refreshGit(true);
      }
    };
    const timer = setInterval(() => {
      if ((getWorkspaceRootPath() || null) !== getGitState().root) {
        void refreshGit();
      } else if (++ticks % 10 === 0 && !getGitState().loading) {
        void refreshGit(true);
      }
    }, 1500);
    window.addEventListener("focus", focus);
    stopWatching = () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }
  return () => {
    if (--watchers === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}
