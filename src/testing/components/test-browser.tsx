import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { BrowserStream } from "../data/browser-store";

export const currentBrowserPage = (streams: BrowserStream[], selected?: string) =>
  streams.find((s) => s.pageId === selected) ??
  [...streams].reverse().find((s) => s.type === "frame") ??
  streams.at(-1);

export const browserLabel = (stream: BrowserStream) =>
  stream.browserName === "chromium"
    ? "Chromium"
    : stream.browserName === "firefox"
      ? "Firefox"
      : stream.browserName === "webkit"
        ? "WebKit"
        : "Browser";

export function TestBrowserControls({
  stream,
  paused,
}: {
  stream?: BrowserStream;
  paused: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const status = paused
    ? "Paused"
    : !stream
      ? "Waiting"
      : stream.type === "closed"
        ? "Finished"
        : now - stream.receivedAt > 5000
          ? "No recent frames"
          : "Live";
  return (
    <div class="flex min-w-0 flex-1 items-center gap-3" aria-label="Test browser page">
      <span class="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          aria-hidden="true"
          class={`h-1.5 w-1.5 rounded-full ${status === "Live" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-muted-foreground/50"}`}
        />
        <span data-testid="test-browser-status">{status}</span>
      </span>
      <span
        class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
        title={stream?.url}
      >
        {stream?.url || "Waiting for a browser page"}
      </span>
    </div>
  );
}

export function TestBrowserTabs({
  streams,
  stream,
  onSelect,
  children,
}: {
  streams: BrowserStream[];
  stream?: BrowserStream;
  onSelect: (id: string) => void;
  children?: ComponentChildren;
}) {
  if (!streams.length) {
    return null;
  }
  return (
    <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/70 bg-card/30 px-3 py-1.5">
      <div
        class="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        role="tablist"
        aria-label="Test browser pages"
      >
        {streams.map((page, index) => (
          <Button
            key={page.pageId}
            role="tab"
            size="xs"
            variant="subtle"
            aria-selected={page.pageId === stream?.pageId}
            tabIndex={page.pageId === stream?.pageId ? 0 : -1}
            class="max-w-56 shrink-0 gap-1.5 aria-selected:bg-muted"
            title={`${page.testName || page.title || page.url}\n${page.projectName || browserLabel(page)}`}
            onClick={() => onSelect(page.pageId)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step && event.key !== "Home" && event.key !== "End") {
                return;
              }
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? streams.length - 1
                    : (index + step + streams.length) % streams.length;
              onSelect(streams[next].pageId);
              (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
            }}
          >
            <span
              aria-hidden="true"
              class={`h-1.5 w-1.5 shrink-0 rounded-full ${page.type === "closed" ? "bg-muted-foreground/40" : "bg-emerald-600 dark:bg-emerald-400"}`}
            />
            <span class="truncate">
              {browserLabel(page)}
              {page.projectName ? ` · ${page.projectName}` : ""} ·{" "}
              {page.title || `Page ${index + 1}`}
            </span>
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function TestBrowser({ stream }: { stream?: BrowserStream }) {
  return (
    <section
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/20"
      aria-label="Application under test"
      data-testid="test-browser"
    >
      <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {stream?.imageId || stream?.image ? (
          <img
            class="h-full max-h-full w-full object-contain drop-shadow-sm"
            src={
              stream.imageId
                ? `${convertFileSrc(stream.imageId, "test-frame")}?t=${stream.timestamp}`
                : `data:image/jpeg;base64,${stream.image}`
            }
            alt={`Application being tested: ${stream.testName || stream.title || stream.url || "Playwright page"}`}
            data-testid="test-browser-screen"
            draggable={false}
          />
        ) : (
          <div class="flex max-w-xs flex-col items-center gap-2 px-4 text-center">
            <Icon name="terminal-window" class="mb-1 text-2xl text-muted-foreground" />
            <p class="text-xs font-medium">Waiting for a browser page</p>
            <p class="text-[11px] leading-5 text-muted-foreground">
              The live app appears here when Playwright opens a page in this terminal.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
