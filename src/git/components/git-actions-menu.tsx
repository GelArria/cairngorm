// The Git panel's one overflow menu: everything except commit, branch switching
// and pull (those stay on screen). Grouped by intent, no duplicates: staging
// lives on the list's group headers.
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { useState } from "preact/hooks";
import type { CommitAction } from "../data/git-bridge";
import type { GitSyncState } from "../hooks/use-git-sync";
import type { GitViewPrefs } from "../hooks/use-git-view-prefs";

const CONFIRM = {
  "pull-rebase": {
    title: "Pull with rebase?",
    message:
      "Rebase local commits onto the current upstream? Commit or stash changes yourself first. No automatic stash or reset is performed; conflicts require manual resolution.",
    label: "Pull Rebase",
  },
  "force-push": {
    title: "Force push with lease?",
    message:
      "Rewrite the current upstream branch with your local HEAD? This can replace published commits. The push is rejected if the remote moved since your last fetch. No plain force push is used.",
    label: "Force push with lease",
  },
} as const;

export function GitActionsMenu({
  sync: { status, remotes, pending, sync },
  busy,
  loading,
  prefs,
  onOperation,
  onOpenGraph,
  onRefresh,
}: {
  sync: GitSyncState;
  busy: boolean;
  /** Spins the menu icon while git reloads or a menu sync runs. */
  loading: boolean;
  prefs: GitViewPrefs;
  onOperation: (action: CommitAction) => void;
  onOpenGraph: () => void;
  onRefresh: () => void;
}) {
  const [confirm, setConfirm] = useState<keyof typeof CONFIRM | null>(null);
  const main = status?.remote ?? remotes[0];
  // Other remotes only add entries when there is more than one.
  const others = remotes.filter((name) => name !== main);
  // Known to have no upstream yet; otherwise a plain push to the upstream.
  const publish = !!status && !status.upstream;
  return (
    <>
      <DropdownMenu
        align="end"
        label="Git actions"
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label="Git actions" title="Git actions">
            <Icon
              name={loading ? "spinner-gap" : "list"}
              class={`text-[13px] ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        }
      >
        {pending && (
          <>
            <DropdownMenuLabel>
              {pending === "cherry-pick" ? "Cherry-pick" : "Revert"} in progress
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={busy}
              onClick={() => onOperation(`${pending}-continue` as CommitAction)}
            >
              Continue {pending}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => onOperation(`${pending}-abort` as CommitAction)}
            >
              Abort {pending}…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Sync</DropdownMenuLabel>
        <DropdownMenuItem disabled={busy} onClick={() => void sync("fetch")}>
          Fetch
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => setConfirm("pull-rebase")}>
          Pull with rebase…
        </DropdownMenuItem>
        {main && (
          <DropdownMenuItem
            data-testid="git-push"
            disabled={busy}
            // push-upstream follows the configured upstream mapping, even when its
            // branch name differs from the local one.
            onClick={() => void sync(publish ? "publish" : "push-upstream", main)}
          >
            {publish ? `Publish branch to ${main}` : "Push"}
          </DropdownMenuItem>
        )}
        {others.map((name) => (
          <DropdownMenuItem key={name} disabled={busy} onClick={() => void sync("push", name)}>
            Push to {name}
          </DropdownMenuItem>
        ))}
        {others.map((name) => (
          <DropdownMenuItem
            key={`fetch-${name}`}
            disabled={busy}
            onClick={() => void sync("fetch", name)}
          >
            Fetch from {name}
          </DropdownMenuItem>
        ))}
        {!remotes.length && (
          <p class="px-2 py-1 text-xs text-muted-foreground">No configured remotes</p>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={busy || !main}
          onClick={() => setConfirm("force-push")}
        >
          Force push with lease…
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={prefs.view === "tree"}
          onClick={() => prefs.setView(prefs.view === "tree" ? "list" : "tree")}
        >
          Show as tree
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={prefs.sort === "name"}
          onClick={() => prefs.setSort(prefs.sort === "name" ? "path" : "name")}
        >
          Sort by file name
        </DropdownMenuCheckboxItem>
        {(
          [
            ["staging", "Group: staged & unstaged"],
            ["tracking", "Group: tracked & untracked"],
            ["none", "No grouping"],
          ] as const
        ).map(([value, text]) => (
          <DropdownMenuItem
            key={value}
            checked={prefs.group === value}
            onClick={() => prefs.setGroup(value)}
          >
            {text}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenGraph}>Open Git Graph</DropdownMenuItem>
        <DropdownMenuItem onClick={onRefresh}>Refresh</DropdownMenuItem>
      </DropdownMenu>
      <ConfirmDialog
        open={!!confirm}
        title={confirm ? CONFIRM[confirm].title : ""}
        message={confirm ? CONFIRM[confirm].message : ""}
        confirmLabel={confirm ? CONFIRM[confirm].label : ""}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) {
            void sync(action);
          }
        }}
      />
    </>
  );
}
