import type { GitPanelState } from "@/git/hooks/use-git-status";

/** Re-root porcelain paths when the explorer opens a subfolder of the repository. */
export function projectFileStatus(git: GitPanelState, rootPath: string | null) {
  const norm = (p: string | null) =>
    (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const repoRoot = norm(git.repoRoot),
    openRoot = norm(rootPath);
  const sameRoot =
    !!rootPath &&
    !!git.repo &&
    !!repoRoot &&
    (openRoot === repoRoot || openRoot.startsWith(repoRoot + "/"));
  const prefix = sameRoot && openRoot !== repoRoot ? openRoot.slice(repoRoot.length + 1) + "/" : "";
  const gitCodes: Record<string, string> = {};
  if (sameRoot) {
    for (const f of git.files) {
      if (f.path.toLowerCase().startsWith(prefix)) {
        gitCodes[f.path.slice(prefix.length)] = f.code;
      }
    }
  }
  return { sameRoot, gitCodes, gitCodeOf: (rel: string) => gitCodes[rel] };
}
