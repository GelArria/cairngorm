// Settings sidebar: pages grouped by area. A column beside the page on wide dialogs,
// a scrolling row above it on narrow ones.
import { Button } from "@/common/ui/button";
import { Icon, type IconName } from "@/common/ui/icon";

export interface SettingsPageLink<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
}

export interface SettingsNavGroup<Id extends string = string> {
  label: string;
  pages: readonly SettingsPageLink<Id>[];
}

export function SettingsNav<Id extends string>({
  groups,
  active,
  onSelect,
}: {
  groups: readonly SettingsNavGroup<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <nav
      aria-label="Settings pages"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/20 p-2 md:w-52 md:flex-col md:gap-4 md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r md:px-2 md:py-3"
    >
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} class="flex gap-1 md:flex-col">
          <div class="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 md:block">
            {group.label}
          </div>
          {group.pages.map(({ id, label, icon }) => (
            <Button
              key={id}
              variant="subtle"
              size="sm"
              aria-pressed={active === id}
              aria-current={active === id ? "page" : undefined}
              data-testid={`settings-nav-${id}`}
              class="shrink-0 justify-start gap-2 px-2 md:w-full"
              onClick={() => onSelect(id)}
            >
              <Icon name={icon} class="text-sm" />
              {label}
            </Button>
          ))}
        </div>
      ))}
    </nav>
  );
}
