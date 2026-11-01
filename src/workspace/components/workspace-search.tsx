// "Search in files" mode of the workspace panel. Owns its subscription to the
// search store, so streamed results re-render this view only — not the tree.
import { CairngormLoader, useLoaderGate } from "@/common/branding/";
import type { SearchMatch } from "@/common/filesystem/fs-bridge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { SearchResultsList } from "@/search/components/search-results-list";
import { useResultLayout } from "@/search/hooks/use-result-layout";
import { useGlobalSearch } from "@/search/index";

// Pressed toggles must read as clearly "on" even on low-contrast themes.
const TOGGLE =
  "h-6 font-mono border border-transparent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90";
const FIELD = "h-7 flex-1 rounded-md bg-card px-2 text-xs placeholder:text-muted-foreground/50";

interface Props {
  onExit: () => void;
  onOpenMatch: (m: SearchMatch, query: string) => void;
}

export function WorkspaceSearch({ onExit, onOpenMatch }: Props) {
  const gs = useGlobalSearch();
  const s = gs.state;
  const layout = useResultLayout(s.results, s.expandedFiles);
  const { fileCount } = layout;
  const n = s.results.length;
  const firstResults = s.loading && n === 0;
  const showLoader = useLoaderGate(!!s.query && !s.error && firstResults);

  return (
    <div class="flex flex-col flex-1 min-h-0 border-t-2 border-primary/70 pt-2">
      <div class="relative px-2 pb-1.5">
        <Input
          data-testid="search-in-files-input"
          class="h-8 border-primary/60 bg-card px-2.5 pr-7 text-xs ring-1 ring-primary/20 placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          placeholder="Search in files…"
          value={s.query}
          onInput={(e) => gs.setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onExit();
              gs.close();
            }
          }}
          autoFocus
        />
        {s.query && (
          <Button
            variant="subtle"
            size="icon-xs"
            class="absolute right-3.5 top-[7px]"
            aria-label="Clear search"
            onClick={() => gs.setQuery("")}
          >
            <Icon name="x" />
          </Button>
        )}
      </div>

      <div class="flex items-center gap-1 px-2 pb-1.5">
        <Button
          variant="subtle"
          size="xs"
          class={TOGGLE}
          aria-pressed={s.caseSensitive}
          onClick={gs.toggleCase}
          title="Match case"
        >
          Aa
        </Button>
        <Button
          variant="subtle"
          size="xs"
          class={TOGGLE}
          aria-pressed={s.wholeWord}
          onClick={gs.toggleWholeWord}
          title="Whole word"
        >
          ab
        </Button>
        <Button
          variant="subtle"
          size="xs"
          class={TOGGLE}
          aria-pressed={s.useRegex}
          onClick={gs.toggleRegex}
          title="Regular expression"
        >
          .*
        </Button>
      </div>

      <div class="flex flex-col gap-1.5 px-2 pb-2">
        <div class="flex items-center gap-1">
          <span class="w-4 shrink-0 text-[11px] text-muted-foreground/70">in</span>
          <Input
            class={FIELD}
            placeholder="include… (*.ts, src)"
            value={s.includePattern}
            onInput={(e) => gs.setIncludePattern((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="flex items-center gap-1">
          <span class="w-4 shrink-0 text-[11px] text-muted-foreground/70">ex</span>
          <Input
            class={FIELD}
            placeholder="exclude… (*.min.js)"
            value={s.excludePattern}
            onInput={(e) => gs.setExcludePattern((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      {s.error && (
        <div class="px-2 pb-1 text-[10px] text-red-400 bg-red-500/5 rounded mx-2 flex items-start gap-1">
          <Icon name="warning-circle" class="shrink-0 mt-0.5" />
          <span class="break-all">{s.error}</span>
        </div>
      )}
      {showLoader ? (
        <CairngormLoader variant="sidebar" label="Searching…" class="h-auto" />
      ) : (
        s.query &&
        !s.error &&
        !firstResults && (
          <div class="flex items-center gap-1.5 px-3.5 pb-1.5 text-[11px] font-medium text-foreground">
            {s.loading && <Icon name="spinner" class="text-[10px] animate-spin shrink-0" />}
            <span>
              {n > 0
                ? `${n} result${n !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}${s.loading ? "…" : ""}`
                : "No results"}
            </span>
          </div>
        )
      )}

      {!showLoader && (
        <SearchResultsList
          layout={layout}
          loading={s.loading}
          onToggleFile={gs.toggleFileExpand}
          onOpenMatch={(m) => onOpenMatch(m, s.query)}
        />
      )}
    </div>
  );
}
