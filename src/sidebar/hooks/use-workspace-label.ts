// Second line of a sidebar terminal row: "<workspace folder> · <branch>".
// Plain subscription to the shared git snapshot — no extra poll/refresh
// (the sidebar's useGitStatus already drives those).
import { getGitState, subscribeGit } from "@/git/hooks/use-git-status";
import { useEffect, useState } from "preact/hooks";

const baseName = (p: string) =>
  p
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? "";
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

type WorkspaceInfo = { root: string | null; folder: string; branch: string | null };

/** Workspace folder name and git branch, separately (the terminal cards show them on two lines). */
export function useWorkspaceInfo(): WorkspaceInfo {
  const [git, setGit] = useState(getGitState);
  useEffect(() => subscribeGit(() => setGit(getGitState())), []);
  return {
    root: git.root,
    folder: git.root ? baseName(git.root) : "",
    branch: git.root ? git.branch : null,
  };
}

/** What a terminal card shows: its own working folder when it was opened
 *  elsewhere — with the branch only when that folder is inside the workspace. */
export function terminalPlace(
  cwd: string | undefined,
  ws: WorkspaceInfo,
): { folder: string; branch: string | null } {
  if (!cwd || (ws.root && norm(cwd) === norm(ws.root))) {
    return { folder: ws.folder, branch: ws.branch };
  }
  const inside = !!ws.root && norm(cwd).startsWith(norm(ws.root) + "/");
  return { folder: baseName(cwd), branch: inside ? ws.branch : null };
}
