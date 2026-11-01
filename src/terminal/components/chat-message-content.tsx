// Assistant text for the Chat UI: ``` fences become code boxes (language label +
// copy), `inline code` and **bold** get light styling; the rest stays plain,
// whitespace-preserving text. An unclosed fence (mid-stream) still renders.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Fragment } from "preact";

const FENCE = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        // split() with a capture group: odd indices are the matches
        if (i % 2 === 0) {
          return <Fragment key={i}>{part}</Fragment>;
        }
        if (part.startsWith("`")) {
          return (
            <code key={i} class="rounded bg-muted px-1 py-px text-[0.92em] text-primary">
              {part.slice(1, -1)}
            </code>
          );
        }
        return (
          <strong key={i} class="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div class="my-1.5 overflow-hidden rounded-md border border-border bg-card">
      <div class="flex h-6 items-center border-b border-border pl-2.5 pr-1 text-[10px] text-muted-foreground/70">
        <span class="uppercase tracking-wide">{lang || "text"}</span>
        <Button
          variant="subtle"
          size="icon-xs"
          class="ml-auto"
          aria-label="Copy code"
          title="Copy code"
          onClick={() => navigator.clipboard?.writeText(code)?.catch(() => {})}
        >
          <Icon name="copy" />
        </Button>
      </div>
      <pre class="overflow-x-auto px-3 py-2 text-xs leading-relaxed text-foreground/90">
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

export function ChatMessageContent({ text }: { text: string }) {
  const nodes: preact.ComponentChild[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE)) {
    const at = m.index ?? 0;
    // blank lines around a fence are spacing already given by the code box margin
    const before = text.slice(last, at).replace(/\n+$/, "");
    if (before) {
      nodes.push(<Inline key={`t${last}`} text={last > 0 ? before.replace(/^\n+/, "") : before} />);
    }
    nodes.push(<CodeBlock key={`c${at}`} lang={m[1]} code={m[2]} />);
    last = at + m[0].length;
  }
  const after = last > 0 ? text.slice(last).replace(/^\n+/, "") : text.slice(last);
  if (after) {
    nodes.push(<Inline key={`t${last}`} text={after} />);
  }
  return <div class="whitespace-pre-wrap break-words">{nodes}</div>;
}
