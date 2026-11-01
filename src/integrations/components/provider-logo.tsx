import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";

// Brand marks from Simple Icons (CC0), bundled locally for offline use. Each is a
// trademark of its owner; public/providers/NOTICE.txt lists sources and versions.
// Agents without a published mark fall back to their initial, never a redrawn logo.
const MARKS: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  copilot: "copilot",
  cursor: "cursor",
  opencode: "opencode",
  qwen: "qwen",
  kimi: "kimi",
  pi: "pi",
  cline: "cline",
  vibe: "mistral",
  junie: "junie",
  trae: "trae",
  qodo: "qodo",
};

const COLOR_MARKS = new Set([
  "droid",
  "amp",
  "kiro",
  "auggie",
  "kilo",
  "continue",
  "crush",
  "aider",
  "openhands",
  "grok",
  "codebuff",
  "letta",
  "commandcode",
  "openclaw",
  "gptme",
  "hermes",
  "omp",
  "codewhale",
  "strix",
  "interpreter",
]);

export const hasProviderLogo = (id: string) => id in MARKS || COLOR_MARKS.has(id);

export function ProviderLogo({ id, class: className }: { id: string; class?: string }) {
  if (id === "api") {
    return <Icon name="plug" class={cn("h-5 w-5", className)} />;
  }
  if (COLOR_MARKS.has(id)) {
    return (
      <img
        src={`/providers/${id}.png`}
        alt=""
        aria-hidden="true"
        width={20}
        height={20}
        class={cn("h-5 w-5 shrink-0 rounded-[4px] object-contain", className)}
      />
    );
  }
  if (!MARKS[id]) {
    return null;
  }
  return (
    <img
      src={`/providers/${MARKS[id]}.svg`}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      // Monochrome marks: black artwork, inverted on dark themes.
      class={cn("h-5 w-5 shrink-0 dark:invert", className)}
    />
  );
}

/** An agent's brand mark on a neutral tile, or its initial when no mark is bundled. */
export function AgentMark({
  id,
  name,
  class: className,
}: {
  id: string;
  name: string;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {hasProviderLogo(id) ? (
        <ProviderLogo id={id} class="h-4 w-4" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
