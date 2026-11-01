// Toolbar controls shared by the catalog-style Settings pages (Skills, MCP servers):
// a search field and a segmented filter with counts.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";

export function SettingsSearch({
  value,
  onChange,
  label,
  class: className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  class?: string;
}) {
  return (
    <label class={cn("relative block min-w-[160px]", className)}>
      <Icon
        name="magnifying-glass"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        placeholder={label}
        aria-label={label}
        class="h-8 pl-8 text-xs"
      />
    </label>
  );
}

export interface FilterTab {
  id: string;
  label: string;
  count: number;
  icon?: ComponentChildren;
}

export function SettingsFilterTabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: FilterTab[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      class="inline-flex max-w-full flex-wrap gap-0.5 self-start rounded-lg border border-border bg-muted/30 p-0.5"
    >
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="subtle"
          size="xs"
          aria-pressed={active === tab.id}
          class="h-7 gap-1.5 px-2.5"
          onClick={() => onSelect(tab.id)}
        >
          {tab.icon}
          {tab.label}
          <span class="tabular-nums text-muted-foreground">{tab.count}</span>
        </Button>
      ))}
    </div>
  );
}
