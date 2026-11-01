import { EmptyState } from "@/common/components/empty-state";
import { SidebarLegend } from "@/common/layout/sidebar-legend";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import type { ComponentChildren } from "preact";
import type { GitFile } from "../data/git-bridge";
import type { GitViewPrefs } from "../hooks/use-git-view-prefs";
import { GitPathTree } from "./git-path-tree";

export function GitChanges({
  files,
  row,
  stage,
  unstage,
  prefs: { view, sort, group },
  statusFailed,
}: {
  files: GitFile[];
  /** Status could not be read: an empty list says nothing about the working tree. */
  statusFailed: boolean;
  row: (file: GitFile, staged: boolean) => ComponentChildren;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
  /** List/tree, sort and grouping live in the Git actions menu. */
  prefs: GitViewPrefs;
}) {
  // Both index and worktree entries survive grouping, even when a file is partially staged.
  const entries = files
    .flatMap((file) => [
      ...(file.code !== "??" && file.code[0] !== " " ? [{ ...file, staged: true }] : []),
      ...(file.code === "??" || file.code[1] !== " " ? [{ ...file, staged: false }] : []),
    ])
    .sort(
      (a, b) =>
        (sort === "name"
          ? a.path.split("/").pop()!.localeCompare(b.path.split("/").pop()!)
          : a.path.localeCompare(b.path)) || a.path.localeCompare(b.path),
    );
  const groups =
    group === "staging"
      ? ["Staged", "Changes"]
      : group === "tracking"
        ? ["Tracked", "Untracked"]
        : ["All changes"];
  const label = (f: (typeof entries)[number]) =>
    group === "staging"
      ? f.staged
        ? "Staged"
        : "Changes"
      : group === "tracking"
        ? f.code === "??"
          ? "Untracked"
          : "Tracked"
        : "All changes";
  // "Stage all" sits on the first group that still holds unstaged files.
  const stageAllGroup = groups.find(
    (name) => name !== "Staged" && entries.some((f) => !f.staged && label(f) === name),
  );
  return (
    <>
      {!entries.length &&
        (statusFailed ? (
          <EmptyState icon="git-branch" text="Changes unavailable while Git status fails." />
        ) : (
          <EmptyState icon="check-circle" text="Working tree clean" />
        ))}
      {groups.map((name) => {
        const items = entries.filter((f) => label(f) === name);
        if (!items.length) {
          return null;
        }
        return (
          <div key={name}>
            <SidebarLegend
              class="pt-2 pb-2"
              label={`${name} (${items.length})`}
              action={
                name === "Staged" ? (
                  <Button
                    data-testid="git-unstage-all"
                    variant="subtle"
                    size="xs"
                    onClick={() => unstage([])}
                  >
                    Unstage all
                  </Button>
                ) : name === stageAllGroup ? (
                  <Button
                    data-testid="git-stage-all"
                    variant="subtle"
                    size="xs"
                    class="gap-1"
                    onClick={() => stage([])}
                  >
                    <Icon name="plus" />
                    Stage all
                  </Button>
                ) : undefined
              }
            />
            {view === "tree" ? (
              <GitPathTree files={items} render={(f) => row(f, f.staged)} />
            ) : (
              items.map((f) => row(f, f.staged))
            )}
          </div>
        );
      })}
    </>
  );
}
