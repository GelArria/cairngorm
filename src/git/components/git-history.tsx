// Sidebar history is flat; topology belongs to the workspace Git Graph.
import { EmptyState } from "@/common/components/empty-state";
import { Button } from "@/common/ui/button";
import { relTime, type GitCommit } from "../data/git-bridge";
import { GitAuthorAvatar } from "./git-author-avatar";

export function GitHistory({
  log,
  onCommitMenu,
  onOpen,
}: {
  log: GitCommit[];
  onCommitMenu?: (e: MouseEvent, c: GitCommit) => void;
  onOpen?: (c: GitCommit) => void;
}) {
  return (
    <div class="flex flex-1 flex-col py-1" data-testid="git-history">
      {!log.length && <EmptyState icon="git-branch" text="No commits yet" />}
      {log.map((c) => (
        <Button
          key={c.hash}
          variant="ghost"
          data-testid="git-commit-row"
          class="flex h-[52px] w-full flex-col items-stretch justify-center gap-1 rounded-none px-3 py-1.5 text-left font-normal"
          title={[c.subject, ...(c.refs ?? []).map((ref) => ref.replace("->", "→"))].join("\n")}
          onClick={() => onOpen?.(c)}
          onContextMenu={(e) => onCommitMenu?.(e, c)}
        >
          <span class="truncate text-xs">{c.subject}</span>
          <span class="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <GitAuthorAvatar author={c.author} email={c.email} />
            <span class="truncate">{c.author}</span>
            <span>·</span>
            <span class="shrink-0">{c.at ? relTime(c.at) : c.time}</span>
            <span>·</span>
            <span class="shrink-0 font-mono">{c.hash.slice(0, 7)}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}
