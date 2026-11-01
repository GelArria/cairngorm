import { ContextMenu } from "@/common/components/context-menu";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups } from "@/common/model/context-menu";
import { Icon } from "@/common/ui/icon";
import { Kbd } from "@/common/ui/kbd";
import { Textarea } from "@/common/ui/textarea";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { BASE_FONT, getFontScale, subscribeFontSize } from "../data/font-zoom";
import { buildChatMessages, type ChatEntry } from "../model/chat-transcript";
import { ChatMessageContent } from "./chat-message-content";

export interface ChatUIViewProps {
  sessionId: string;
  events: import("../shared/agent-events").AgentEvent[];
  status: string;
  onSend(text: string): void;
}

/**
 * Chat UI — independent panel, one per agent terminal (like fig. 2).
 * Black terminal-box voice: block separators, no bubble chrome.
 * Keyboard-first: Enter sends (no buttons) — the key hints sit under the composer.
 */
// Split with two visible chat panes: both document-keydown listeners fire
// → without an arbiter the last-mounted one would steal focus. The view that
// was last clicked/typed in wins (null = nobody claimed it yet).
let lastClickedChatRoot: HTMLElement | null = null;

export function ChatUIView({ sessionId, events, status, onSend }: ChatUIViewProps) {
  const [input, setInput] = useState("");
  // Ctrl + / - / 0 zoom (shared with TUI): proportional CSS zoom on the whole view
  const [fontScale, setFontScale] = useState(getFontScale);
  useEffect(() => subscribeFontSize((fs) => setFontScale(fs / BASE_FONT)), []);
  const messages = useMemo(() => buildChatMessages(events), [events]);
  const cm = useContextMenu();
  const copy = (text: string) => void navigator.clipboard?.writeText(text)?.catch(() => {});
  const messageMenu = (e: MouseEvent, m: ChatEntry) => {
    const sel = window.getSelection()?.toString() ?? "";
    cm.open(
      e,
      groups(
        [
          { label: "Copy", action: () => copy(sel), disabled: !sel },
          { label: "Copy Message", action: () => copy(m.content) },
        ],
        [{ label: "Copy All", action: () => copy(messages.map((x) => x.content).join("\n\n")) }],
      ),
    );
  };
  // Smart autoscroll: pin only while the user is (near) the bottom — scrolling
  // up mid-stream must not snap back to the bottom on every event (reviewer P2).
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The <Textarea> wrapper's ref doesn't hand back the DOM node (Preact +
  // spread), so the composer is found by query — the div ref is reliable.
  const getTA = (): HTMLTextAreaElement | null =>
    (composerRef.current?.querySelector("textarea") as HTMLTextAreaElement) ?? null;
  const resetComposerHeight = () => {
    const ta = composerRef.current?.querySelector("textarea");
    if (ta) {
      ta.style.height = "auto";
    }
  };
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);
  const busy = status === "running";

  const handleSend = () => {
    const text = input.trim();
    if (!text || !sessionId) {
      return;
    }
    onSend(text);
    setInput("");
    resetComposerHeight();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Click-to-type: a click anywhere in the view focuses the composer.
  // (The TUI calls term.focus() on mount; here focus used to die on <body>
  // after a click/selection and typed keys were lost — you had to re-click.)
  // Focus goes on MOUSEUP: mousedown's default action (Chromium focus→body)
  // overrides focus set during mousedown. A live text selection keeps focus
  // outside — mouseup doesn't kill the copy.
  const onMouseUp = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.("textarea,input,button,[data-no-drag]")) {
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      return;
    }
    lastClickedChatRoot = rootRef.current;
    getTA()?.focus();
  };

  // Type-anywhere: a printable key with the view visible and focus outside an
  // editable focuses the composer; the keydown's default action then inserts
  // the character there (single insert, normal onInput + auto-grow path).
  // Hidden panes (display:none on the wrapper) bail via offsetParent; a
  // lastClicked root that has been hidden since is reset so typing lands.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing ||
        e.key.length !== 1
      ) {
        return;
      }
      const root = rootRef.current;
      if (!root || root.offsetParent === null) {
        return;
      }
      if (lastClickedChatRoot && lastClickedChatRoot.offsetParent === null) {
        lastClickedChatRoot = null;
      }
      if (lastClickedChatRoot && lastClickedChatRoot !== root) {
        return;
      }
      const t = document.activeElement as HTMLElement | null;
      if (
        t?.getClientRects().length &&
        (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return;
      }
      getTA()?.focus();
      lastClickedChatRoot = root;
      // A kept-alive TUI can retain focus while hidden; do not send its key to the PTY.
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      ref={rootRef}
      onMouseUp={onMouseUp}
      class="surface-base flex flex-1 flex-col min-h-0 bg-background font-mono text-foreground"
      style={{ zoom: fontScale }}
    >
      {/* Transcript */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        class="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <div class="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <Icon
              name={busy ? "circle-notch" : "chat-teardrop-text"}
              strokeWidth={1.5}
              class={`text-[26px] text-muted-foreground/50 ${busy ? "animate-spin" : ""}`}
            />
            <span class="text-xs text-muted-foreground">
              {busy ? "Thinking…" : "Waiting for agent events…"}
            </span>
            {!busy && (
              <span class="text-[11px] text-muted-foreground/60">
                Type below to start talking to the agent.
              </span>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} onContextMenu={(e) => messageMenu(e, m)}>
            <MessageBlock m={m} />
          </div>
        ))}
      </div>

      {/* Composer */}
      <div
        ref={composerRef}
        class="surface-strip-terminal shrink-0 border-t border-border bg-card px-3 pb-1.5 pt-2"
      >
        <div class="flex items-start gap-2">
          <span
            aria-hidden="true"
            class={`select-none pt-[3px] text-[13px] leading-[1.35] ${busy ? "text-muted-foreground/40" : "text-amber-400/80"}`}
          >
            ›
          </span>
          <Textarea
            class="min-h-[26px] max-h-32 flex-1 bg-transparent border-none px-0 py-0.5 text-[13px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:ring-0 focus:outline-none focus-visible:ring-0 resize-none"
            rows={1}
            placeholder="Type a message…"
            value={input}
            onInput={(e: Event) => {
              const ta = e.currentTarget as HTMLTextAreaElement;
              setInput(ta.value);
              // Auto-grow: one line to start, expands with content up to max-h-32
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div class="mt-1 flex items-center gap-3 pl-4 font-sans text-[10px] text-muted-foreground/60">
          <span class="flex items-center gap-1.5">
            <Kbd keys={["Enter"]} /> send
          </span>
          <span class="flex items-center gap-1.5">
            <Kbd keys={["Shift", "Enter"]} /> new line
          </span>
          {busy && (
            <span class="ml-auto flex items-center gap-1.5 text-emerald-400/80">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              running
            </span>
          )}
        </div>
      </div>
      <ContextMenu menu={cm.menu} />
    </div>
  );
}

function MessageBlock({ m }: { m: ChatEntry }) {
  if (m.isHeader) {
    return (
      <div class="text-[11px] font-mono">
        <span class="text-emerald-400/80">{m.content}</span>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div class="flex items-start gap-2">
        <span class="mt-0.5 w-0.5 self-stretch bg-amber-400/70 shrink-0" />
        <p class="text-[13px] font-mono text-foreground whitespace-pre-wrap break-words">
          {m.content}
        </p>
      </div>
    );
  }
  if (m.role === "tool") {
    const running = m.toolStatus === "running";
    return (
      <div class="flex items-baseline gap-2 text-xs font-mono text-muted-foreground">
        <span
          class={`inline-block w-4 text-center ${running ? "text-emerald-400 animate-pulse" : "text-muted-foreground/40"}`}
        >
          {running ? "✱" : "▸"}
        </span>
        <span class={running ? "text-emerald-400/90" : "text-muted-foreground/70"}>
          {m.toolName}
        </span>
        {m.toolArg && <span class="text-muted-foreground/40">"{m.toolArg}"</span>}
        {m.content && (
          <span class="text-muted-foreground/55 truncate max-w-[180px]">
            → {m.content.split("\n")[0]}
          </span>
        )}
        {m.isError && <span class="text-red-400/80">· error</span>}
      </div>
    );
  }
  // assistant text
  return (
    <div class="pl-1 text-[13px] font-mono text-foreground/90">
      <ChatMessageContent text={m.content} />
    </div>
  );
}
