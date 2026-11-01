// Strip under the grid listing tabs that live in their own window; click focuses it.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import type { TermTab } from "../model/types";

export function DetachedBar({
  tabs,
  onFocus,
}: {
  tabs: TermTab[];
  onFocus: (windowLabel: string) => void;
}) {
  if (tabs.length === 0) {
    return null;
  }
  return (
    <div class="flex items-center gap-1.5 px-2 h-5 border-t border-border bg-card shrink-0 animate-in fade-in slide-in-from-bottom-1 duration-200">
      <Icon name="arrow-square-out" class="text-[9px] text-blue-400/60" />
      <span class="text-[10px] text-muted-foreground/50 font-mono">{tabs.length} detached</span>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="subtle"
          size="xs"
          class="ml-1 h-4 px-1.5 font-mono text-[9px] text-blue-400/70 hover:text-blue-300"
          onClick={() => {
            if (tab.detachedWindowLabel) {
              onFocus(tab.detachedWindowLabel);
            }
          }}
        >
          {tab.title}
        </Button>
      ))}
    </div>
  );
}
