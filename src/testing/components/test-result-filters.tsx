import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { cn } from "@/common/utils";

export function TestResultFilters({
  failedOnly,
  query,
  onToggle,
  onQuery,
  class: className,
}: {
  failedOnly: boolean;
  query: string;
  onToggle: () => void;
  onQuery: (value: string) => void;
  class?: string;
}) {
  return (
    <div class={cn("flex min-w-0 items-center gap-2", className)}>
      <Button
        variant="subtle"
        size="xs"
        class="gap-1.5 aria-pressed:bg-destructive/10 aria-pressed:text-destructive"
        aria-pressed={failedOnly}
        onClick={onToggle}
      >
        <Icon name="warning-circle" class="text-xs" />
        Failed only
      </Button>
      <div class="relative min-w-0 flex-1">
        <Icon
          name="magnifying-glass"
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
        />
        <Input
          class="h-7 border-border/70 bg-background pl-6 pr-2 text-xs"
          aria-label="Filter tests"
          placeholder="Filter tests…"
          value={query}
          onInput={(e) => onQuery(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}
