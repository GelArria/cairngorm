// Settings ▸ General ▸ Terminal: the same label-left, control-right rows as the rest.
import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { RadioGroup, RadioGroupItem } from "@/common/ui/radio-group";
import { useTerminalPreferences } from "@/terminal/hooks/use-terminal-preferences";
import {
  SCROLLBACK_RANGE,
  setTerminalPreferences,
  TERMINAL_DEFAULTS,
} from "../../terminal/data/terminal-preferences";
import type { DetectedShell } from "../../terminal/types";
import { SettingsRow } from "./settings-layout";
import { shellIdentity } from "@/terminal/model/launch-profile";
import { LaunchProfilesSettings } from "@/terminal/components/launch-profiles-settings";

const clamp = (value: number) =>
  Math.max(SCROLLBACK_RANGE.min, Math.min(SCROLLBACK_RANGE.max, Math.round(value)));

export function TerminalSettings({ shells }: { shells: DetectedShell[] | null }) {
  const p = useTerminalPreferences();
  const missing =
    p.defaultShell &&
    shells &&
    !shells.some((s) => shellIdentity(s) === shellIdentity(p.defaultShell!));
  return (
    <div class="flex flex-col gap-3" data-testid="terminal-settings">
      <SettingsRow
        label="Default shell"
        hint={
          missing
            ? "Saved shell not detected. Select another if it is no longer installed."
            : "Used for new terminals. Running sessions are not changed."
        }
      >
        <DropdownMenu
          trigger={
            <Button
              id="terminal-default-shell"
              aria-label="Default shell"
              variant="outline"
              size="sm"
              class="w-44 justify-between font-normal"
              disabled={shells === null}
            >
              <span class="truncate">{p.defaultShell?.name ?? "System default"}</span>
              <Icon name="caret-down" />
            </Button>
          }
        >
          <DropdownMenuItem
            checked={!p.defaultShell}
            onClick={() => setTerminalPreferences({ defaultShell: null })}
          >
            System default
          </DropdownMenuItem>
          {shells?.map((s) => (
            <DropdownMenuItem
              key={shellIdentity(s)}
              checked={!!p.defaultShell && shellIdentity(p.defaultShell) === shellIdentity(s)}
              onClick={() => setTerminalPreferences({ defaultShell: s })}
            >
              {s.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      </SettingsRow>
      <SettingsRow
        label="Clipboard shortcuts"
        hint={
          p.clipboard === "windows"
            ? "Ctrl+C copies a selection; without one, it interrupts. Ctrl+V pastes."
            : "Ctrl+C and Ctrl+V go to the program, even with text selected. Ctrl+Shift+C/V copy and paste."
        }
      >
        <RadioGroup
          value={p.clipboard}
          onValueChange={(mode) =>
            setTerminalPreferences({ clipboard: mode as typeof p.clipboard })
          }
          aria-label="Clipboard shortcuts"
          class="flex rounded-md border border-border p-0.5"
        >
          {(["windows", "ctrl-shift"] as const).map((mode) => (
            <RadioGroupItem
              key={mode}
              value={mode}
              class="inline-flex h-6 items-center rounded px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-accent aria-checked:text-foreground"
            >
              {mode === "windows" ? "Ctrl+C / Ctrl+V" : "Ctrl+Shift+C / V"}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </SettingsRow>
      <SettingsRow
        label="Scrollback lines"
        hint="100–100,000 per terminal. Lowering it discards older output."
      >
        <Input
          aria-label="Scrollback lines"
          key={p.scrollback}
          type="number"
          class="h-8 w-28 text-right font-mono text-xs tabular-nums"
          min={SCROLLBACK_RANGE.min}
          max={SCROLLBACK_RANGE.max}
          step={100}
          defaultValue={p.scrollback}
          onBlur={(e) => {
            const input = e.currentTarget;
            const value = input.valueAsNumber;
            if (Number.isFinite(value)) {
              setTerminalPreferences({ scrollback: value });
            }
            input.value = String(Number.isFinite(value) ? clamp(value) : p.scrollback);
          }}
        />
      </SettingsRow>
      <LaunchProfilesSettings shells={shells ?? []} />
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p class="max-w-[68ch] text-[11px] leading-snug text-muted-foreground">
          Shell shortcuts stay in the terminal. Ctrl+Shift+W closes a pane; drag its grip to move it
          without selecting text.
        </p>
        <Button
          variant="outline"
          size="xs"
          onClick={() => setTerminalPreferences(TERMINAL_DEFAULTS)}
        >
          Reset terminal preferences
        </Button>
      </div>
    </div>
  );
}
