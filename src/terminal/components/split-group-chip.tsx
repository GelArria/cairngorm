// Leading chip of a split group in the tab bar: shows the group number in the
// group colour; its menu picks another colour or dissolves the group.
import { TAG_COLORS, tagHex } from "@/appearance/model/tag-colors";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";

interface Props {
  number: number;
  color?: string;
  shown: boolean;
  onColor: (color: string) => void;
  onUngroup: () => void;
}

export function SplitGroupChip({ number, color, shown, onColor, onUngroup }: Props) {
  const hex = tagHex(color) ?? "hsl(var(--muted-foreground))";
  return (
    <DropdownMenu
      label={`Group ${number}`}
      class="self-stretch"
      trigger={
        <button
          type="button"
          data-group-chip
          aria-label={`Group ${number} options`}
          title={`Group ${number} — colour and options`}
          class="flex size-9 shrink-0 items-center justify-center font-sans text-[11px] font-bold leading-none tabular-nums text-background transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          style={{ background: hex, opacity: shown ? 1 : 0.8 }}
        >
          {number}
        </button>
      }
    >
      <DropdownMenuLabel class="text-[11px]">Group {number} colour</DropdownMenuLabel>
      {TAG_COLORS.map((c) => (
        <DropdownMenuItem
          key={c.id}
          checked={c.id === color}
          onClick={() => onColor(c.id)}
          class="gap-2 text-xs"
        >
          <span class="h-3 w-3 shrink-0 rounded-full" style={{ background: c.hex }} />
          {c.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onUngroup} class="gap-2 text-xs">
        <Icon name="square" />
        Ungroup
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
