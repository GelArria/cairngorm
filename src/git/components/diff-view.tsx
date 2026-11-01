// Read-only diff pane (Δ tabs from the Git panel): commit header, collapsible
// hunks, old/new line numbers, +/− rows with word-level highlight.
import { ChevronIcon } from "@/common/ui/animated-icon";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { useMemo, useState } from "preact/hooks";
import { parseDiff, splitDiffLines, type DiffLine } from "../model/diff-parse";

const ROW_BG = { add: "bg-green-500/10", del: "bg-red-500/10", ctx: "" } as const;
const NUM = { add: "text-green-400/80", del: "text-red-400/80", ctx: "text-neutral-600" } as const;
const MARK = { add: "+", del: "−", ctx: "" } as const;

function Text({ line }: { line: DiffLine }) {
  if (!line.word) {
    return <>{line.text}</>;
  }
  const [s, e] = line.word;
  const hl = line.kind === "add" ? "bg-green-500/30" : "bg-red-500/30";
  return (
    <>
      {line.text.slice(0, s)}
      <span class={`rounded-sm ${hl}`}>{line.text.slice(s, e)}</span>
      {line.text.slice(e)}
    </>
  );
}

function SplitCell({ line, side }: { line?: DiffLine; side: "before" | "after" }) {
  return (
    <div
      data-testid={`diff-${side}`}
      class={`flex min-w-0 border-r border-border ${line ? ROW_BG[line.kind] : "bg-secondary/30"}`}
    >
      <span class={`w-11 shrink-0 select-none pr-2 text-right ${line ? NUM[line.kind] : ""}`}>
        {side === "before" ? line?.old : line?.new}
      </span>
      <span class="min-w-0 flex-1 whitespace-pre-wrap break-words px-2 text-foreground/90">
        {line && <Text line={line} />}
      </span>
    </div>
  );
}

export function DiffView({ content }: { content: string }) {
  const diff = useMemo(() => parseDiff(content), [content]);
  const [split, setSplit] = useState(true);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setClosed((c) => {
      const n = new Set(c);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  return (
    <div
      class="surface-base flex h-full flex-col overflow-hidden bg-background font-mono"
      data-testid="diff-view"
    >
      {diff.subject !== undefined && (
        <div class="flex shrink-0 items-start gap-4 border-b border-border px-4 py-2.5">
          <div class="min-w-0 flex-1">
            <div class="truncate text-[10.5px] text-muted-foreground">
              {diff.author} · <span class="text-violet-400">{diff.hash}</span> · {diff.age}
            </div>
            <div class="mt-0.5 truncate font-sans text-sm font-semibold text-foreground">
              {diff.subject}
            </div>
          </div>
          <span class="shrink-0 text-[11px]">
            <span class="text-green-400">+{diff.added}</span>{" "}
            <span class="text-red-400">−{diff.removed}</span>
          </span>
        </div>
      )}
      <div class="flex shrink-0 items-center justify-end gap-1 border-b border-border px-3 py-1 font-sans">
        <span class="mr-auto text-[11px] text-muted-foreground">
          <span class="text-green-400">+{diff.added}</span>{" "}
          <span class="text-red-400">−{diff.removed}</span>
        </span>
        <Button variant="subtle" size="xs" aria-pressed={!split} onClick={() => setSplit(false)}>
          Unified
        </Button>
        <Button variant="subtle" size="xs" aria-pressed={split} onClick={() => setSplit(true)}>
          Side by side
        </Button>
      </div>
      {split && (
        <div class="grid shrink-0 grid-cols-2 border-b border-border text-[11px] text-muted-foreground">
          <span class="border-r border-border px-3 py-1">Before</span>
          <span class="px-3 py-1">After</span>
        </div>
      )}
      <div class="min-h-0 flex-1 overflow-auto text-xs leading-5">
        {diff.raw !== undefined && (
          <pre class="whitespace-pre-wrap p-4 text-muted-foreground">{diff.raw || "(no diff)"}</pre>
        )}
        {diff.hunks.map((h, i) => {
          const prev = diff.hunks[i - 1];
          const gap = prev ? h.oldStart - prev.oldEnd - 1 : 0;
          return (
            <div key={i}>
              {gap > 0 && (
                <div class="flex h-6 items-center gap-2 border-y border-border bg-secondary/40 px-4 font-sans text-[11px] text-muted-foreground">
                  <Icon name="arrows-vertical" class="text-xs" />
                  {gap} unchanged lines
                </div>
              )}
              <button
                class="flex h-6 w-full items-center gap-2 border-b border-border bg-blue-500/[.07] px-3 text-left text-[11px] text-blue-300/90 outline-none hover:bg-blue-500/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => toggle(i)}
              >
                <ChevronIcon open={!closed.has(i)} class="text-[10px]" />
                <span class="truncate">{h.header}</span>
              </button>
              {!closed.has(i) &&
                (split
                  ? splitDiffLines(h.lines).map((r, k) => (
                      <div key={k} class="grid grid-cols-2" data-testid="diff-split-row">
                        <SplitCell line={r.before} side="before" />
                        <SplitCell line={r.after} side="after" />
                      </div>
                    ))
                  : h.lines.map((l, k) => (
                      <div
                        key={k}
                        class={`flex ${ROW_BG[l.kind]} ${l.kind !== "ctx" ? `border-l-2 ${l.kind === "add" ? "border-green-500" : "border-red-500"}` : "border-l-2 border-transparent"}`}
                      >
                        <span class={`w-11 shrink-0 select-none pr-2 text-right ${NUM[l.kind]}`}>
                          {l.old ?? ""}
                        </span>
                        <span class={`w-11 shrink-0 select-none pr-2 text-right ${NUM[l.kind]}`}>
                          {l.new ?? ""}
                        </span>
                        <span
                          class={`w-6 shrink-0 select-none text-center ${l.kind === "add" ? "text-green-400" : "text-red-400"}`}
                        >
                          {MARK[l.kind]}
                        </span>
                        <span class="whitespace-pre pr-4 text-foreground/90">
                          <Text line={l} />
                        </span>
                      </div>
                    )))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
