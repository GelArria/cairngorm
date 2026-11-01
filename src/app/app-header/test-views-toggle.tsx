import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { hideTestsTabs, showHiddenTestsTabs, useTerminalTabs } from "@/terminal/workspace";
import { setTestAutoOpen } from "@/testing/data/test-auto-open";
import { useTestAutoOpen } from "@/testing/hooks/use-test-auto-open";
import { useState } from "preact/hooks";
import { HeaderButton } from "./header-button";

/**
 * Toggles whether detected test runs open Tests views. Turning it off while views
 * are open asks whether to hide them or keep them updating; no new view opens either way.
 */
export function TestViewsToggle() {
  const enabled = useTestAutoOpen();
  const { state } = useTerminalTabs({ content: false });
  const openViews = state.tabs.filter((t) => t.kind === "tests" && !t.detached && !t.hidden).length;
  const hiddenViews = state.tabs.filter(
    (t) => t.kind === "tests" && !t.detached && t.hidden,
  ).length;
  const [choosing, setChoosing] = useState(false);
  const toggle = (open: boolean) => {
    if (!open) {
      setChoosing(false);
    } else if (hiddenViews > 0 || openViews > 0) {
      setChoosing(true);
    } else {
      setTestAutoOpen(!enabled);
    }
  };
  const tip = enabled ? "Auto-open test views: on" : "Auto-open test views: off";
  return (
    <DropdownMenu
      align="end"
      open={choosing}
      onOpenChange={toggle}
      trigger={
        <HeaderButton
          tip={tip}
          icon={enabled ? "flask" : "flask-off"}
          active={enabled}
          testId="header-test-auto-open"
        />
      }
    >
      <div class="w-[min(260px,85vw)]" data-testid="test-auto-open-choice">
        <div class="px-2 pb-0.5 pt-1 text-xs font-semibold">Test views</div>
        {hiddenViews > 0 && (
          <DropdownMenuItem class="gap-2 text-xs" onClick={showHiddenTestsTabs}>
            <Icon name="eye" />
            Show hidden test views
          </DropdownMenuItem>
        )}
        {!enabled && (
          <DropdownMenuItem class="text-xs" onClick={() => setTestAutoOpen(true)}>
            Enable auto-opening test views
          </DropdownMenuItem>
        )}
        <p class="px-2 pb-1.5 text-[11px] text-muted-foreground">
          {openViews === 1 ? "1 test view is open." : `${openViews} test views are open.`} New test
          runs will not open views.
        </p>
        <DropdownMenuItem
          class="gap-2 text-xs"
          onClick={() => {
            setTestAutoOpen(false);
            hideTestsTabs();
          }}
        >
          <Icon name="eye-off" class="text-sm text-muted-foreground" />
          Hide open test views
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-2 text-xs" onClick={() => setTestAutoOpen(false)}>
          <Icon name="eye" class="text-sm text-muted-foreground" />
          Keep showing open views
        </DropdownMenuItem>
      </div>
    </DropdownMenu>
  );
}
