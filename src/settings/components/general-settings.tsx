// Settings ▸ General: display, startup, terminal defaults, shells, diagnostics, version.
import { setGemDisplay, useSystemMotion } from "@/appearance/data/motion-preferences";
import { useGemDisplay } from "@/appearance/hooks/use-gem-display";
import { CairngormLogo } from "@/common/branding/";
import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { SIDEBAR_POSITIONS, setSidebarSide, useSidebarSide } from "@/common/layout/sidebar-side";
import { Badge } from "@/common/ui/badge";
import { getConfig, subscribeConfig, updateConfig } from "@/config";
import { SettingsFileSection } from "@/config/settings-file-section";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Toggle } from "@/common/ui/toggle";
import { Tooltip } from "@/common/ui/tooltip";
import { useTerminalPreferences } from "@/terminal/hooks/use-terminal-preferences";
import { useEffect, useState } from "preact/hooks";
import { FONT_SIZE_RANGE, setFontSize, subscribeFontSize } from "../../terminal/data/font-zoom";
import { isDefaultShell } from "../../terminal/data/terminal-preferences";
import { shellIdentity } from "@/terminal/model/launch-profile";
import { useAppInfo } from "../hooks/use-app-info";
import { SettingsPage, SettingsRow, SettingsSection } from "./settings-layout";
import { TerminalSettings } from "./terminal-settings";

export const SPLASH_PREF_KEY = "show-splash";
const LOGS = "%APPDATA%\\Cairngorm\\logs";
const SEGMENT = "aria-pressed:bg-accent aria-pressed:text-foreground";

function FontSize() {
  const [font, setFont] = useState(FONT_SIZE_RANGE.base);
  useEffect(() => subscribeFontSize(setFont), []);
  return (
    <>
      <Tooltip content="Decrease font size" shortcut="fontDecrease">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Smaller"
          disabled={font <= FONT_SIZE_RANGE.min}
          onClick={() => setFontSize(font - 1)}
        >
          <Icon name="minus" class="text-xs" />
        </Button>
      </Tooltip>
      <span
        class="w-10 text-center font-mono text-xs tabular-nums text-foreground"
        data-testid="settings-font-size"
      >
        {font}px
      </span>
      <Tooltip content="Increase font size" shortcut="fontIncrease">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Bigger"
          disabled={font >= FONT_SIZE_RANGE.max}
          onClick={() => setFontSize(font + 1)}
        >
          <Icon name="plus" class="text-xs" />
        </Button>
      </Tooltip>
      <Tooltip content="Reset font size" shortcut="fontReset">
        <Button
          variant="ghost"
          size="xs"
          disabled={font === FONT_SIZE_RANGE.base}
          onClick={() => setFontSize(FONT_SIZE_RANGE.base)}
        >
          Reset
        </Button>
      </Tooltip>
    </>
  );
}

/** `app.keepRunning` in cairngorm.json: on unless set to false, saved only when off. */
function KeepRunning() {
  const read = () => (getConfig().app as { keepRunning?: unknown } | undefined)?.keepRunning;
  const [keep, setKeep] = useState(read() !== false);
  useEffect(() => subscribeConfig(() => setKeep(read() !== false)), []);
  return (
    <SettingsRow
      label="Keep running after closing"
      hint="While an agent or program runs, closing the window keeps Cairngorm in the tray. Quit from the tray icon to stop them."
    >
      <Toggle
        checked={keep}
        onCheckedChange={(next) => {
          setKeep(next);
          updateConfig(["app", "keepRunning"], next ? undefined : false).catch(() =>
            setKeep(read() !== false),
          );
        }}
        aria-label="Keep running after closing"
        data-testid="settings-keep-running"
      />
    </SettingsRow>
  );
}

export function GeneralSettings({ open }: { open: boolean }) {
  const [splash, setSplash] = useLocalStorage(SPLASH_PREF_KEY, true);
  const { version, shells } = useAppInfo(open);
  const side = useSidebarSide();
  const preferences = useTerminalPreferences();
  const { forceMotion } = useGemDisplay();
  return (
    <SettingsPage
      title="General"
      description="Text size, motion, layout and terminal defaults."
      sectioned
      data-testid="general-settings"
    >
      <SettingsFileSection />
      <SettingsSection title="Display">
        <SettingsRow
          label="Terminal & chat font size"
          hint="Shared by terminal and chat. Shortcuts are in Keybindings."
        >
          <FontSize />
        </SettingsRow>
        <SettingsRow
          label="Animations"
          hint="Always: icons, transitions and the splash play even when the system reduces motion."
        >
          <div
            role="group"
            aria-label="Animations"
            class="flex rounded-md border border-border p-0.5"
          >
            <Button
              variant="subtle"
              size="xs"
              aria-pressed={!forceMotion}
              class={SEGMENT}
              onClick={useSystemMotion}
            >
              System
            </Button>
            <Button
              variant="subtle"
              size="xs"
              aria-pressed={forceMotion}
              class={SEGMENT}
              onClick={() => setGemDisplay({ forceMotion: true, frozen: false })}
            >
              Always
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label="Sidebar position" hint="Also in the title bar's sidebar button.">
          <div
            role="radiogroup"
            aria-label="Sidebar position"
            class="flex rounded-md border border-border p-0.5"
            data-testid="settings-sidebar-side"
          >
            {SIDEBAR_POSITIONS.map(({ side: s, label }) => (
              <Button
                key={s}
                variant="subtle"
                size="xs"
                role="radio"
                aria-checked={side === s}
                class="aria-checked:bg-accent aria-checked:text-foreground"
                onClick={() => setSidebarSide(s)}
              >
                {label}
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Show splash screen" hint="The Cairngorm loader while the app starts.">
          <Toggle checked={splash} onCheckedChange={setSplash} aria-label="Show splash screen" />
        </SettingsRow>
        <KeepRunning />
      </SettingsSection>

      <SettingsSection title="Terminal">
        <TerminalSettings shells={shells} />
      </SettingsSection>

      <SettingsSection title="Shells">
        {shells === null ? (
          <span class="text-xs text-muted-foreground">Detecting…</span>
        ) : shells.length === 0 ? (
          <span class="text-xs text-muted-foreground">
            None detected. New terminals use the platform default.
          </span>
        ) : (
          shells.map((s) => (
            <SettingsRow key={shellIdentity(s)} label={s.name} hint={s.path}>
              {isDefaultShell(s, preferences) && <Badge variant="outline">default</Badge>}
            </SettingsRow>
          ))
        )}
      </SettingsSection>

      <SettingsSection title="Diagnostics">
        <SettingsRow
          label="Crash and hang reports"
          hint="Rust panics, frontend errors and watchdog hang dumps."
        >
          <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">
            {LOGS}
          </code>
          <Tooltip content="Copy path">
            <Button
              variant="subtle"
              size="icon-sm"
              aria-label="Copy path"
              onClick={() => navigator.clipboard?.writeText(LOGS)?.catch(() => {})}
            >
              <Icon name="copy" class="text-xs" />
            </Button>
          </Tooltip>
        </SettingsRow>
        <SettingsRow label="Version">
          <CairngormLogo size={18} />
          <span class="font-mono text-xs text-foreground" data-testid="settings-version">
            {version ?? "—"}
          </span>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
