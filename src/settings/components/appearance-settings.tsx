import { getAppearancePalette, resetAppearance, setAppearance } from "@/appearance/data/store";
import { useAppearance } from "@/appearance/hooks/use-appearance";
import { contrastRatio } from "@/appearance/model/colors";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Toggle } from "@/common/ui/toggle";
import { AppearanceControls } from "./appearance-controls";
import { FileIconSettings } from "./file-icon-settings";
import { SettingsPage } from "./settings-layout";
import { ThemePresets } from "./theme-presets";

export function AppearanceSettings() {
  const p = useAppearance();
  const c = getAppearancePalette();
  const ratio = contrastRatio(c.background, c.foreground);
  return (
    <SettingsPage
      title="Themes & colors"
      description={
        <>
          Current theme: <span class="text-foreground">{c.theme.name}</span>. Changes apply to every
          window instantly.
        </>
      }
      actions={
        <>
          <label class="flex items-center gap-2 text-xs">
            <Toggle
              checked={p.mode === "system"}
              onCheckedChange={(checked) => setAppearance({ mode: checked ? "system" : "preset" })}
              aria-label="Follow system theme"
            />
            Follow system
          </label>
          <Button variant="outline" size="xs" onClick={resetAppearance}>
            Reset adjustments
          </Button>
        </>
      }
      data-testid="appearance-settings"
    >
      <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="min-w-0">
          <ThemePresets />
          <section
            class="mt-4 overflow-hidden rounded-md border border-border bg-background"
            aria-label="Live appearance preview"
          >
            <div class="flex items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs">
              <Icon name="terminal" />
              <span class="flex-1 font-medium">Cairngorm</span>
              <Icon name="minus" />
              <Icon name="x" />
            </div>
            <div class="flex">
              <div class="flex w-10 flex-col items-center gap-3 border-r border-border bg-card py-3">
                <Icon name="files" />
                <Icon name="git-branch" />
                <Icon name="gear-six" />
              </div>
              <div class="flex-1 space-y-2 p-3">
                <p class="text-xs">Your workspace, your colors.</p>
                <p class="text-[11px] text-muted-foreground">Secondary text and separators</p>
                <div class="h-px bg-border" />
                <div class="flex items-center gap-2 text-xs text-primary">
                  <Icon name="check" />
                  Ready
                </div>
              </div>
            </div>
          </section>
          <p
            class={`mt-2 text-[11px] ${ratio < 4.5 ? "text-destructive" : "text-muted-foreground"}`}
            role="status"
          >
            Text contrast: {ratio.toFixed(1)}:1 ·{" "}
            {ratio >= 4.5 ? "Readable for small text" : "Low contrast — adjust text or background"}
          </p>
        </div>
        <div class="min-w-0">
          <AppearanceControls />
        </div>
      </div>
      {/* Full width below both columns: neither column runs long on its own. */}
      <div class="border-t border-border pt-5">
        <FileIconSettings />
      </div>
    </SettingsPage>
  );
}
