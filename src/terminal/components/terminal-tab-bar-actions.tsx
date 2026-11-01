// Split menus at the right of the terminal tab bar (act on the active tab's group):
// "Split" picks what joins the group (a new terminal or a loose tab), "Arrange"
// re-lays the group on screen so its panes share the whole area.
import { Button } from "@/common/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/common/ui/dropdown-menu";
import { Icon, type IconName } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import type { ArrangeMode } from "../model/layout/arrange";
import type { TermTab } from "../model/types";

interface Props {
  canSplit: boolean;
  canToggleSplit: boolean;
  hasSplit: boolean;
  /** Open tabs outside any split group that may join the active one. */
  candidates: TermTab[];
  onSplitNew: () => void;
  onJoin: (tabId: string) => void;
  onArrange: (mode: ArrangeMode) => void;
  onUngroup: () => void;
}

const ARRANGE: { mode: ArrangeMode; label: string; icon: IconName }[] = [
  { mode: "auto", label: "Auto (fit the area)", icon: "layout-dashboard" },
  { mode: "columns", label: "Side by side", icon: "columns" },
  { mode: "rows", label: "Stacked", icon: "rows" },
  { mode: "grid", label: "Mosaic grid", icon: "layout-grid" },
];

export function TerminalTabBarActions({
  canSplit,
  canToggleSplit,
  hasSplit,
  candidates,
  onSplitNew,
  onJoin,
  onArrange,
  onUngroup,
}: Props) {
  return (
    <div class="flex h-full shrink-0 items-center gap-0.5 px-1.5">
      <DropdownMenu
        align="end"
        label="Split"
        trigger={
          <Tooltip
            content={hasSplit ? "Add to split" : "Split"}
            shortcut={canToggleSplit ? "toggleSplit" : undefined}
            side="bottom"
          >
            <Button
              variant="subtle"
              size="icon-sm"
              class="text-[13px]"
              aria-label={hasSplit ? "Add to split" : "Split"}
              disabled={!canSplit}
            >
              <Icon name="columns" />
            </Button>
          </Tooltip>
        }
      >
        <DropdownMenuItem onClick={onSplitNew} class="gap-2 text-xs">
          <Icon name="plus" />
          New terminal
        </DropdownMenuItem>
        {candidates.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="text-[11px]">
              {hasSplit ? "Add an open tab" : "Split with an open tab"}
            </DropdownMenuLabel>
            {candidates.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => onJoin(t.id)} class="gap-2 text-xs">
                <span class="max-w-56 truncate">{t.title}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenu>
      <DropdownMenu
        align="end"
        label="Arrange split"
        trigger={
          <Tooltip content="Arrange split" side="bottom">
            <Button
              variant="subtle"
              size="icon-sm"
              class="text-[13px]"
              aria-label="Arrange split"
              disabled={!hasSplit}
            >
              <Icon name="layout-grid" />
            </Button>
          </Tooltip>
        }
      >
        {ARRANGE.map((a) => (
          <DropdownMenuItem key={a.mode} onClick={() => onArrange(a.mode)} class="gap-2 text-xs">
            <Icon name={a.icon} />
            {a.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onUngroup} class="gap-2 text-xs">
          <Icon name="square" />
          Ungroup
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
