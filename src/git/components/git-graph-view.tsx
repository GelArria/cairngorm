import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { useGitGraphView } from "@/git/hooks/use-git-graph-view";
import { relTime } from "../data/git-bridge";
import { openGitCommit } from "../data/git-panes";
import { GitCommitDetail } from "./git-commit-detail";
import { GraphCell, RefChip } from "./git-graph-cell";
export function GitGraphView({ content }: { content: string }) {
  const {
    root,
    log,
    selected,
    setSelected,
    error,
    busy,
    more,
    query,
    setQuery,
    setRevision,
    loadMore,
    graph,
    search,
    matches,
    matchingHashes,
    navigate,
    columns,
  } = useGitGraphView({ content });

  if (!root) {
    return <InlineNotice message="Invalid Git Graph reference. Reopen it from Git." />;
  }
  return (
    <section
      class="surface-base flex h-full min-h-0 flex-col overflow-hidden bg-background [container-type:inline-size]"
      data-testid="git-graph-view"
      aria-label="Git Graph"
    >
      <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="git-branch" class="text-muted-foreground" />
        <span class="shrink-0 text-xs font-semibold">Git Graph</span>
        <Input
          aria-label="Search commits"
          placeholder="Search commits…"
          class="h-7 min-w-0 flex-1 text-xs"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigate(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span class="shrink-0 text-[10px] text-muted-foreground">
          {search ? `${matches.length} matches` : `${log.length} commits`}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous matching commit"
          disabled={!matches.length}
          onClick={() => navigate(-1)}
        >
          <Icon name="caret-up" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next matching commit"
          disabled={!matches.length}
          onClick={() => navigate(1)}
        >
          <Icon name="caret-down" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh graph"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <Icon name="arrow-clockwise" />
        </Button>
      </header>
      {error && <InlineNotice message={error} class="m-2" />}
      <div class="flex min-h-0 flex-1 flex-col [@container(min-width:860px)]:flex-row">
        <div
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
          aria-label="Commit graph table"
        >
          <div class="min-w-max">
            <div
              class="sticky top-0 z-10 grid h-7 items-center border-b border-border bg-card text-[11px] text-muted-foreground"
              style={{ gridTemplateColumns: columns }}
            >
              {["Graph", "Description", "Date", "Author", "Commit"].map((label) => (
                <span key={label} class="px-2">
                  {label}
                </span>
              ))}
            </div>
            {log.map((commit, i) => {
              const refs = (commit.refs ?? []).filter((r) => r !== "grafted");
              const match = !search || matchingHashes.has(commit.hash);
              return (
                <Button
                  id={`graph-${commit.hash}`}
                  key={commit.hash}
                  variant="ghost"
                  data-testid="git-graph-row"
                  aria-pressed={selected === commit.hash}
                  class={`grid h-9 w-full justify-start rounded-none p-0 text-left font-normal ${selected === commit.hash ? "bg-accent" : ""} ${match ? "" : "opacity-40"}`}
                  style={{ gridTemplateColumns: columns }}
                  title={
                    refs.length
                      ? `${commit.subject}\n${refs.map((r) => r.replace("->", "→")).join(", ")}`
                      : commit.subject
                  }
                  onClick={() => setSelected(commit.hash)}
                  onDblClick={() => openGitCommit(root, commit)}
                >
                  <GraphCell
                    row={graph.rows[i]}
                    width={graph.width}
                    head={refs.some((r) => r.startsWith("HEAD"))}
                  />
                  <span class="flex min-w-0 items-center gap-2 overflow-hidden px-2">
                    {refs.slice(0, 1).map((ref) => (
                      <RefChip key={ref} name={ref} lane={graph.rows[i].lane} />
                    ))}
                    {refs.length > 1 && (
                      <span
                        data-testid="git-ref-count"
                        class="shrink-0 text-[9px] text-muted-foreground"
                        title={refs.map((r) => r.replace("->", "→")).join(", ")}
                      >
                        +{refs.length - 1}
                      </span>
                    )}
                    <span class="min-w-0 flex-1 truncate text-xs">{commit.subject}</span>
                  </span>
                  <span class="truncate px-2 text-[10px] text-muted-foreground">
                    {commit.at ? relTime(commit.at) : commit.time}
                  </span>
                  <span class="truncate px-2 text-[11px] text-muted-foreground">
                    {commit.author}
                  </span>
                  <span class="px-2 font-mono text-[10px] text-muted-foreground">
                    {commit.hash.slice(0, 7)}
                  </span>
                </Button>
              );
            })}
          </div>
          {!log.length && (
            <div role="status" class="p-4 text-xs text-muted-foreground">
              {busy
                ? "Loading graph…"
                : error
                  ? "Could not load history. Use Refresh graph to retry."
                  : "No commits yet"}
            </div>
          )}
          {more && (
            <Button
              variant="subtle"
              size="sm"
              class="m-2 shrink-0"
              disabled={busy}
              onClick={() => void loadMore()}
            >
              {busy ? "Loading…" : "Load older commits"}
            </Button>
          )}
        </div>
        {selected && (
          <aside
            class="h-72 min-h-0 shrink-0 border-t border-border [@container(min-width:860px)]:h-auto [@container(min-width:860px)]:w-80 [@container(min-width:860px)]:border-l [@container(min-width:860px)]:border-t-0"
            aria-label="Selected commit inspector"
          >
            <GitCommitDetail
              key={selected}
              inspector
              content={JSON.stringify({ root, hash: selected })}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
