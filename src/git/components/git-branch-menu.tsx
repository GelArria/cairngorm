import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { PromptDialog } from "@/common/ui/prompt-dialog";
import { useGitBranchMenu } from "@/git/hooks/use-git-branch-menu";

export function GitBranchMenu({
  root,
  branch,
  loading,
  refresh,
  onError,
}: {
  root: string | null;
  branch: string | null;
  loading: boolean;
  refresh: () => void;
  onError: (e: string) => void;
}) {
  const { branches, busy, creating, setCreating, query, setQuery, listing, switchTo } =
    useGitBranchMenu({ root, branch, loading, refresh, onError });

  return (
    <>
      <DropdownMenu
        class="min-w-0 max-w-full [&>div]:min-w-0 [&>div]:max-w-full"
        trigger={
          <Button
            variant="subtle"
            size="xs"
            class={`h-auto min-w-0 max-w-full justify-start gap-1.5 px-0 text-xs font-semibold`}
            aria-label="Switch branch"
            aria-haspopup="menu"
            title={branch ?? "HEAD"}
            disabled={busy || !root}
          >
            <Icon
              name={busy ? "spinner" : "git-branch"}
              class={`text-[11px] ${busy ? "motion-safe:animate-spin" : "text-muted-foreground"}`}
            />
            <span class="min-w-0 truncate" title={branch ?? "HEAD"} data-testid="git-branch">
              {branch ?? "HEAD"}
            </span>
            <Icon name="caret-down" class="text-[10px] text-muted-foreground" />
          </Button>
        }
      >
        <div class="p-1">
          <Input
            class="h-7 text-xs"
            aria-label="Filter branches"
            placeholder="Find a branch…"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <div class="max-h-64 max-w-[min(360px,calc(100vw-16px))] overflow-auto">
          {branches
            .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
            .map((name) => (
              <DropdownMenuItem
                key={name}
                class="font-mono text-xs"
                checked={name === branch}
                onClick={() => void switchTo(name)}
              >
                <span class="truncate" title={name}>
                  {name}
                </span>
              </DropdownMenuItem>
            ))}
          {!branches.some((name) => name.toLowerCase().includes(query.toLowerCase())) && (
            <p class="px-2 py-3 text-xs text-muted-foreground">
              {listing ? "Loading branches…" : "No matching branches."}
            </p>
          )}
        </div>
        <DropdownMenuItem onClick={() => setCreating(true)}>Create branch…</DropdownMenuItem>
      </DropdownMenu>
      <PromptDialog
        open={creating}
        title="Create branch"
        label="Branch name"
        confirmLabel="Create"
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          setCreating(false);
          void switchTo(name, true);
        }}
      />
    </>
  );
}
