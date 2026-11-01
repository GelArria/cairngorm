// The sidebar's "nothing here yet": the shared empty state (muted icon, one line, a
// hint), one compact action and, when it has one, the action's current shortcut.
import { EmptyState } from "@/common/components/empty-state";
import { Button } from "@/common/ui/button";
import { Icon, type IconName } from "@/common/ui/icon";
import { Kbd } from "@/common/ui/kbd";
import { bindingKeys, getBinding, type KeybindingId } from "@/keybindings/data/keybindings";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";

interface Props {
  icon: IconName;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
  /** Shown as "or press …" with the user's current binding. */
  shortcut?: KeybindingId;
  testId: string;
}

export function SidebarEmpty({
  icon,
  title,
  description,
  action,
  onAction,
  shortcut,
  testId,
}: Props) {
  useKeybindingPreferences();
  const binding = shortcut ? getBinding(shortcut) : null;
  return (
    <EmptyState data-testid={testId} icon={icon} text={title} description={description} heading>
      <Button variant="outline" size="xs" class="mt-1 gap-1" onClick={onAction}>
        <Icon name="plus" class="text-[11px]" />
        {action}
      </Button>
      {binding && (
        <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          or press <Kbd keys={bindingKeys(binding)} />
        </span>
      )}
    </EmptyState>
  );
}
