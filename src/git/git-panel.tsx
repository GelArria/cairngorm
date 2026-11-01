import { ContextMenu } from "@/common/components/context-menu";
import { useGitPanel } from "@/git/hooks/use-git-panel";
import { GitActionDialogs } from "./components/git-action-dialogs";
// GitPanel: branch · pull · actions menu, then the commit box and Changes / History tabs.
// Only commit, branch switching and pull stay on screen; the rest lives in GitActionsMenu. Replaces the module content while
// Git is on; state comes from the module singleton (use-git-status.ts).
import { CairngormLoader } from "@/common/branding/";
import { EmptyState } from "@/common/components/empty-state";
import { InlineNotice } from "@/common/components/inline-notice";
import { ScrollArea } from "@/common/ui/scroll-area";
import { GitChanges } from "./components/git-changes";
import { GitCommitBox } from "./components/git-commit-box";
import { GitFileRow } from "./components/git-file-row";
import { GitHistory } from "./components/git-history";
import { GitPanelHeader } from "./components/git-panel-header";
import { GitViewTabs } from "./components/git-view-tabs";
import { type GitFile } from "./data/git-bridge";
import { openGitCommit } from "./data/git-panes";

export function GitPanel() {
  const {
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
  } = useGitPanel();

  if (showLoader) {
    return <CairngormLoader variant="sidebar" label="Loading git status…" class="h-auto" />;
  }
  if (firstLoad) {
    return null;
  }
  if (git.error === "no-repo") {
    return (
      <EmptyState
        icon="git-branch"
        text="Open a folder that is a git repository to see changes here."
      />
    );
  }
  if (git.error === "no-folder") {
    return <EmptyState icon="folder-open" text="No folder open — use the folder button above." />;
  }
  // porcelain: XY — x = index (staged); the commit box needs the staged count.
  const staged = git.files.filter((f) => f.code !== "??" && f.code[0] !== " ");
  const row = (f: GitFile, isStaged: boolean) => (
    <GitFileRow
      key={`${isStaged}${f.path}`}
      file={f}
      staged={isStaged}
      selected={selected === `${isStaged ? "s" : "u"}:${f.path}`}
      details={git.details[f.path]}
      onToggle={() => (isStaged ? git.unstage([f.path]) : git.stage([f.path]))}
      onOpen={() => void openDiff(f, isStaged)}
      onContextMenu={(e) => menus.fileMenu(e, f, isStaged)}
    />
  );

  return (
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="git-panel"
      onContextMenu={menus.panelMenu}
    >
      <GitPanelHeader
        git={git}
        syncState={syncState}
        syncBusy={syncBusy}
        prefs={prefs}
        setActionError={setActionError}
        onOperation={menus.operation}
      />

      {git.error && git.error !== "no-repo" && git.error !== "no-folder" && (
        <InlineNotice data-testid="git-error" message={git.error} class="mx-3 mb-1.5 shrink-0" />
      )}
      {actionError && (
        <InlineNotice
          message={actionError}
          class="mx-3 mb-1.5 shrink-0"
          onDismiss={() => setActionError(null)}
        />
      )}
      {diffError && (
        <InlineNotice
          message={`Diff failed: ${diffError}`}
          class="mx-3 mb-1.5 shrink-0"
          onDismiss={() => setDiffError(null)}
        />
      )}

      <GitCommitBox
        key={git.root}
        git={git}
        stagedCount={staged.length}
        syncState={syncState}
        syncBusy={syncBusy}
      />
      <GitViewTabs tab={tab} setTab={setTab} changes={git.files.length} />
      <ScrollArea
        id="git-view"
        role="tabpanel"
        aria-labelledby={`git-tab-${tab}`}
        class="flex min-h-32 flex-1 flex-col"
      >
        {tab === "changes" && (
          <GitChanges
            files={git.files}
            row={row}
            stage={git.stage}
            unstage={git.unstage}
            prefs={prefs}
            statusFailed={git.statusFailed}
          />
        )}
        {tab === "history" && (
          <GitHistory
            log={git.log}
            onCommitMenu={menus.commitMenu}
            onOpen={(commit) => {
              if (git.repoRoot ?? git.root) {
                openGitCommit((git.repoRoot ?? git.root)!, commit);
              }
            }}
          />
        )}
      </ScrollArea>
      <ContextMenu menu={menus.menu} />
      <GitActionDialogs {...menus.dialogs} />
    </div>
  );
}
