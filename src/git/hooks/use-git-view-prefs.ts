import { useLocalStorage } from "@/common/hooks/use-local-storage";

/** How the Changes list is shown. Owned by the panel: the actions menu edits it. */
export function useGitViewPrefs() {
  const [view, setView] = useLocalStorage<"list" | "tree">("git-changes-view", "list");
  const [sort, setSort] = useLocalStorage<"path" | "name">("git-changes-sort", "path");
  const [group, setGroup] = useLocalStorage<"staging" | "tracking" | "none">(
    "git-changes-group",
    "staging",
  );
  return { view, setView, sort, setSort, group, setGroup };
}

export type GitViewPrefs = ReturnType<typeof useGitViewPrefs>;
