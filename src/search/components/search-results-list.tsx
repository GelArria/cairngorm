import { ResultLayout } from "@/search/model/result-layout";
import { OVERSCAN, rowAt } from "../model/result-layout";
// Search hits grouped by file, virtualized: only the rows in (or near) the
// viewport are mounted, so 5000 streamed matches cost the same to render as 50.
import type { SearchMatch } from "@/common/filesystem/fs-bridge";
import { ChevronIcon } from "@/common/ui/animated-icon";
import { Icon } from "@/common/ui/icon";
import { ScrollArea } from "@/common/ui/scroll-area";
import { FileTypeIcon } from "@/workspace/components/file-type-icon";
import { useEffect, useRef, useState } from "preact/hooks";

function HighlightedLine({ text, start, end }: { text: string; start: number; end: number }) {
  const trimmed = text.trimStart();
  const offset = text.length - trimmed.length;
  const adjStart = Math.max(0, start - offset);
  const adjEnd = Math.max(0, end - offset);
  if (adjStart === adjEnd || adjStart > trimmed.length) {
    return <span class="truncate font-mono text-[11px] text-foreground/80">{trimmed}</span>;
  }
  return (
    <span class="truncate font-mono text-[11px]">
      <span class="text-foreground/80">{trimmed.slice(0, adjStart)}</span>
      <span class="rounded-sm bg-foreground px-0.5 text-background">
        {trimmed.slice(adjStart, adjEnd)}
      </span>
      <span class="text-foreground/80">{trimmed.slice(adjEnd)}</span>
    </span>
  );
}

interface Props {
  layout: ResultLayout;
  loading: boolean;
  onToggleFile: (path: string) => void;
  onOpenMatch: (m: SearchMatch) => void;
}

export function SearchResultsList({
  layout: { rows, tops },
  loading,
  onToggleFile,
  onOpenMatch,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      setView({ top: el.scrollTop, height: el.clientHeight || 600 });
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(measure);
      }
    };
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const total = tops[rows.length];
  const start = rows.length ? rowAt(tops, view.top - OVERSCAN) : 0;
  const end = rows.length
    ? Math.min(rows.length, rowAt(tops, view.top + view.height + OVERSCAN) + 1)
    : 0;

  return (
    <ScrollArea viewportRef={ref} class="flex flex-col flex-1 min-h-0" data-testid="search-results">
      <div style={{ height: total, position: "relative", flexShrink: 0 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            transform: `translateY(${tops[start] ?? 0}px)`,
          }}
        >
          {rows.slice(start, end).map((row) =>
            row.kind === "file" ? (
              <div
                key={`f:${row.path}`}
                class="mx-1.5 flex h-6 cursor-pointer items-center gap-1.5 rounded-[5px] px-2 text-xs hover:bg-secondary"
                onClick={() => onToggleFile(row.path)}
              >
                <ChevronIcon
                  open={row.expanded}
                  class="w-2.5 text-[10px] text-muted-foreground/70"
                />
                <FileTypeIcon name={row.name} />
                <span class="truncate text-foreground">{row.name}</span>
                <span class="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {row.count}
                </span>
                {loading && (
                  <Icon name="circle" class="text-[6px] text-primary animate-pulse shrink-0" />
                )}
              </div>
            ) : (
              <div
                key={`m:${row.m.path}:${row.m.line}:${row.m.col}`}
                class="mx-1.5 flex h-5 cursor-pointer items-center gap-2 rounded-[5px] pl-7 pr-2 hover:bg-secondary"
                onClick={() => onOpenMatch(row.m)}
              >
                <span class="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/60">
                  {row.m.line}
                </span>
                <HighlightedLine
                  text={row.m.lineText ?? ""}
                  start={row.m.matchStart}
                  end={row.m.matchEnd}
                />
              </div>
            ),
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
