import { APP_OPEN_SETTINGS, onAppEvent } from "@/common/events/app-events";
import type { SidebarSide } from "@/common/layout/sidebar-side";
import { DropdownMenu } from "@/common/ui/dropdown-menu";
import { UsagePanel } from "@/integrations/components/usage-panel";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";
import { SettingsDialog } from "@/settings/settings-dialog";
import { SidebarPositionMenu } from "@/sidebar/components/sidebar-position-menu";
import { UpdateDialog } from "@/updates/update-dialog";
import { useLayoutEffect, useState } from "preact/hooks";
import { getWindowPlatform, WindowControls } from "../../common/ui/window-controls";
import { AppMenu } from "./app-menu";
import { HeaderButton } from "./header-button";
import { HelpPanel } from "./help-panel";
import { StorageWarning } from "./storage-warning";
import { buildMenuSections } from "./menu-sections";
import { TestViewsToggle } from "./test-views-toggle";

export interface AppHeaderProps {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onNewFile: () => void;
  onSave: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  /** Preferred navigation edge. */
  sidebarSide?: SidebarSide;
  onSelectSidebarSide?: (side: SidebarSide) => void;
}

export function AppHeader({
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onNewFile,
  onSave,
  onOpenFile,
  onOpenFolder,
  sidebarSide = "left",
  onSelectSidebarSide,
}: AppHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<string>();
  const platform = getWindowPlatform();
  const macos = platform === "macos";
  useKeybindingPreferences();
  /** Without a page, Settings reopens on the page it last showed. */
  const showSettings = (page?: string) => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  // e.g. the terminal area's "Add an API key" → Settings
  useLayoutEffect(() => onAppEvent<string | undefined>(APP_OPEN_SETTINGS, showSettings), []);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const menuSections = buildMenuSections({
    onNewFile,
    onSave,
    onOpenFile,
    onOpenFolder,
    onSettings: showSettings,
    onCheckUpdates: () => setUpdatesOpen(true),
  });

  return (
    <>
      <div
        data-tauri-drag-region
        // Over a top dock, a title bar that follows the sidebar drops its divider.
        data-dock={sidebarSide === "top" || sidebarSide === "bottom" ? sidebarSide : undefined}
        class="grid h-[38px] shrink-0 select-none grid-cols-[auto_1fr_auto] items-center border-b border-border bg-card surface-header px-2 max-[450px]:px-0"
      >
        {/* Left: nav arrows, app menu (creating lives in each sidebar section header) */}
        <div class="flex h-full items-center justify-start gap-0.5 max-[450px]:gap-0">
          {macos && <WindowControls platform={platform} />}
          <HeaderButton
            tip="Back"
            shortcut="back"
            icon="caret-left"
            onClick={onBack}
            disabled={!canGoBack}
          />
          <HeaderButton
            tip="Forward"
            shortcut="forward"
            icon="caret-right"
            onClick={onForward}
            disabled={!canGoForward}
          />
          <AppMenu groups={menuSections} />
          {/* The one place to move the navigation (sidebar or dock), in every layout. */}
          {onSelectSidebarSide && (
            <SidebarPositionMenu
              side={sidebarSide}
              onSelect={onSelectSidebarSide}
              align="start"
              trigger={
                <HeaderButton
                  tip="Navigation position"
                  icon="layout"
                  testId="header-sidebar-side-toggle"
                />
              }
            />
          )}
        </div>
        <div data-tauri-drag-region class="h-full min-w-0" />

        {/* Right: utility actions and OS-shaped window controls share this title bar. */}
        <div class="flex h-full items-center justify-end gap-0.5 max-[450px]:gap-0">
          <StorageWarning />
          <TestViewsToggle />
          <DropdownMenu
            align="end"
            trigger={<HeaderButton tip="AI usage" icon="gauge" testId="header-ai-usage" />}
          >
            <UsagePanel />
          </DropdownMenu>
          <HeaderButton
            tip="Settings"
            shortcut="settings"
            icon="gear-six"
            testId="header-settings"
            onClick={() => showSettings()}
          />
          <DropdownMenu
            align="end"
            trigger={<HeaderButton tip="Help" icon="question" testId="header-help" />}
          >
            <HelpPanel />
          </DropdownMenu>
          {!macos && <WindowControls platform={platform} />}
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        initialPage={settingsPage}
        onClose={() => setSettingsOpen(false)}
      />
      <UpdateDialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
    </>
  );
}
