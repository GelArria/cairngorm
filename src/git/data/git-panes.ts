import { openInEditor } from "@/workspace/data/open-file";
import type { GitCommit } from "./git-bridge";

export function openGitGraph(root: string) {
  openInEditor({
    title: "Git Graph",
    path: ["git-graph", root],
    extension: "git-graph",
    content: JSON.stringify({ root }),
  });
}
export function openGitCommit(
  root: string,
  commit: Pick<GitCommit, "hash" | "subject">,
  file?: string,
) {
  openInEditor({
    title: `${commit.hash.slice(0, 7)} — ${commit.subject}`,
    path: ["git", root, commit.hash, ...(file ? [file] : [])],
    extension: "git-commit",
    content: JSON.stringify({ root, hash: commit.hash, ...(file ? { file } : {}) }),
  });
}
