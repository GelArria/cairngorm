import { useLoaderGate } from "@/common/branding/";
import { type GitTab } from "@/git/components/git-view-tabs";
import { gitDiff, relTime, type DiffKind, type GitFile } from "@/git/data/git-bridge";
import { useGitMenus } from "@/git/hooks/use-git-menus";
import { useGitStatus } from "@/git/hooks/use-git-status";
import { useGitSync } from "@/git/hooks/use-git-sync";
import { useGitViewPrefs } from "@/git/hooks/use-git-view-prefs";
import { useEffect, useState } from "preact/hooks";

export function useGitPanel() {
  const git = useGitStatus();
  const [tab, setTab] = useState<GitTab>("changes");
  useEffect(() => {
    git.refresh();
  }, [git.refresh]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const syncState = useGitSync(git, syncBusy, setSyncBusy, setActionError);
  const prefs = useGitViewPrefs();
  // Errors belong to the folder they came from.
  useEffect(() => {
    setActionError(null);
    setDiffError(null);
  }, [git.root]);

  // Click a row → open its diff as a file pane, headed by the last commit
  // (author <email> · hash · age · subject) like a blame annotation.
  async function openDiff(f: GitFile, isStaged: boolean) {
    if (!git.root) {
      return;
    }
    setSelected(`${isStaged ? "s" : "u"}:${f.path}`);
    setDiffError(null);
    const kind: DiffKind = f.code === "??" ? "untracked" : isStaged ? "staged" : "unstaged";
    try {
      const text = await gitDiff(git.root, f.path, kind);
      const d = git.details[f.path];
      const head = d
        ? `● ${d.author} <${d.email}> · ${d.hash} · ${relTime(d.at)}\n${d.subject}\n\n`
        : "";
      const name = f.path.split("/").pop() ?? f.path;
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: `Δ ${name}`,
            path: [name],
            content: head + (text || "(no diff)"),
            extension: "diff",
          },
        }),
      );
    } catch (err) {
      setDiffError(String(err));
    }
  }

  const menus = useGitMenus({
    repoRoot: git.repoRoot,
    root: git.root,
    refresh: git.refresh,
    stage: git.stage,
    unstage: git.unstage,
    openDiff: (f, isStaged) => void openDiff(f, isStaged),
    onError: setActionError,
  });

  // only the very first load of a folder (a refresh keeps showing what is loaded)
  const firstLoad = git.loading && !git.repo && !git.error;
  const showLoader = useLoaderGate(firstLoad);
  return {
    git,
    tab,
    setTab,
    selected,
    diffError,
    setDiffError,
    actionError,
    setActionError,
    syncBusy,
    syncState,
    prefs,
    openDiff,
    menus,
    firstLoad,
    showLoader,
  };
}
