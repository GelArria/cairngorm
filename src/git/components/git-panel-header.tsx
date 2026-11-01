// Git panel header: branch switcher, Pull (with commits behind) and the actions menu.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import type { CommitAction } from "../data/git-bridge";
import { openGitGraph } from "../data/git-panes";
import type { useGitStatus } from "../hooks/use-git-status";
import type { GitSyncState } from "../hooks/use-git-sync";
import type { GitViewPrefs } from "../hooks/use-git-view-prefs";
import { GitActionsMenu } from "./git-actions-menu";
import { GitBranchMenu } from "./git-branch-menu";

export function GitPanelHeader({
  git,
  syncState,
  syncBusy,
  prefs,
  setActionError,
  onOperation,
}: {
  git: ReturnType<typeof useGitStatus>;
  syncState: GitSyncState;
  syncBusy: boolean;
  prefs: GitViewPrefs;
  setActionError: (message: string | null) => void;
  onOperation: (action: CommitAction) => void;
}) {
  const { status, running } = syncState;
  const behind = status?.behind ?? 0;
  // Known to have nothing to pull from (unknown status keeps Pull available).
  const noUpstream = !!status && !status.upstream;
  return (
    <div class="flex shrink-0 items-center gap-1 px-3 py-2">
      <div class="flex min-w-0 flex-1 font-mono">
        <GitBranchMenu
          root={git.root}
          branch={git.branch}
          loading={git.loading}
          refresh={git.refresh}
          onError={setActionError}
        />
      </div>
      <Button
        variant="ghost"
        size="xs"
        class="gap-1.5"
        data-testid="git-pull"
        title={
          noUpstream
            ? "No upstream yet: publish the branch from Git actions first"
            : behind > 0
              ? `Pull ${behind} commit${behind === 1 ? "" : "s"}`
              : "Pull"
        }
        disabled={syncBusy || git.loading || noUpstream}
        onClick={() => void syncState.sync("pull")}
      >
        <Icon
          name={running === "pull" ? "spinner-gap" : "arrow-down"}
          class={running === "pull" ? "animate-spin" : undefined}
        />
        Pull
        {behind > 0 && (
          <span class="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
            {behind}
          </span>
        )}
      </Button>
      <GitActionsMenu
        sync={syncState}
        busy={syncBusy || git.loading}
        loading={git.loading || (!!running && running !== "pull")}
        prefs={prefs}
        onOperation={onOperation}
        onOpenGraph={() => {
          if (git.repoRoot ?? git.root) {
            openGitGraph((git.repoRoot ?? git.root)!);
          }
        }}
        onRefresh={git.refresh}
      />
    </div>
  );
}
