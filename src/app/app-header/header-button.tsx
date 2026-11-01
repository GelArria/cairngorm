import { Button } from "@/common/ui/button";
import { Icon, type IconName } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import type { KeybindingId } from "@/keybindings/data/keybindings";

/** Icon button of the title bar; `active` renders as a pressed toggle. */
export function HeaderButton({
  tip,
  shortcut,
  icon,
  onClick,
  disabled,
  testId,
  active,
}: {
  tip: string;
  shortcut?: KeybindingId;
  icon: IconName;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  active?: boolean;
}) {
  return (
    <Tooltip content={tip} shortcut={shortcut}>
      <Button
        variant="subtle"
        size="icon"
        class="h-7 w-7"
        data-tauri-no-drag-region
        data-testid={testId}
        aria-label={tip}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon name={icon} class="text-sm" />
      </Button>
    </Tooltip>
  );
}
