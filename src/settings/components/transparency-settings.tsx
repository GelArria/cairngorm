import { setTransparency } from "@/appearance/data/transparency";
import { useTransparency } from "@/appearance/hooks/use-transparency";
import {
  DEFAULT_TRANSPARENCY,
  OVERALL_MIN,
  SURFACE_MIN,
  type Material,
  type SurfaceKey,
} from "@/appearance/model/transparency-preferences";
import { Button } from "@/common/ui/button";
import { Label } from "@/common/ui/label";
import { RadioGroup, RadioGroupItem, RadioIndicator } from "@/common/ui/radio-group";
import { Slider } from "@/common/ui/slider";
import { Toggle } from "@/common/ui/toggle";
import { SettingsPage, SettingsRow, SettingsSection } from "./settings-layout";

const PLATFORM = navigator.userAgent;
const IS_LINUX = /Linux/.test(PLATFORM) && !/Android/.test(PLATFORM);

const MATERIALS: { id: Material; label: string; hint: string }[] = [
  {
    id: "blur",
    label: "Frosted",
    hint: "Blurs the windows behind (Acrylic). Windows may lag while dragging or resizing.",
  },
  { id: "mica", label: "Mica", hint: "Tints with the wallpaper (Windows 11)" },
  { id: "clear", label: "Clear", hint: "Plain glass, no blur" },
];

const PARTS: { key: SurfaceKey; label: string }[] = [
  { key: "header", label: "Title bar" },
  { key: "sidebar", label: "Sidebar" },
  { key: "tabs", label: "Tab bar" },
  { key: "terminal", label: "Terminals" },
  { key: "panels", label: "Editor & panels" },
  { key: "overlays", label: "Menus & dialogs" },
];

function OpacitySlider({
  id,
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div class="mb-1 flex items-center justify-between">
        <Label for={id} class="text-[11px] font-normal">
          {label}
        </Label>
        <output for={id} class="font-mono text-[11px] tabular-nums text-muted-foreground">
          {value}%
        </output>
      </div>
      <Slider
        id={id}
        min={min}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </div>
  );
}

export function TransparencySettings() {
  const t = useTransparency();
  const off = !t.enabled;
  return (
    <SettingsPage
      title="Transparency"
      description="See your desktop through Cairngorm. Choose global or per-part opacity; 100% is solid."
      sectioned
      actions={
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            setTransparency({ ...DEFAULT_TRANSPARENCY, enabled: t.enabled, material: t.material })
          }
        >
          Reset levels
        </Button>
      }
      data-testid="transparency-settings"
    >
      <SettingsSection title="Window">
        <SettingsRow label="Transparent window" hint="Applies to every Cairngorm window.">
          <Toggle
            checked={t.enabled}
            onCheckedChange={(enabled) => setTransparency({ enabled })}
            aria-label="Transparent window"
          />
        </SettingsRow>
        <SettingsRow
          label="Material"
          hint={IS_LINUX ? "Linux shows the desktop without blur." : "What shows behind the glass."}
        >
          {/* A disabled fieldset disables every option natively. */}
          <fieldset disabled={off} class="contents">
            <RadioGroup
              value={t.material}
              onValueChange={(material) => setTransparency({ material: material as Material })}
              aria-label="Window material"
              class="flex flex-wrap gap-1.5"
            >
              {MATERIALS.map((m) => (
                <RadioGroupItem
                  key={m.id}
                  value={m.id}
                  title={m.hint}
                  class="flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary"
                >
                  <RadioIndicator checked={t.material === m.id} />
                  {m.label}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </fieldset>
        </SettingsRow>
        <SettingsRow
          label="Transparency priority"
          hint="Global uses one opacity everywhere. By part ignores global opacity. Switching keeps both sets of levels."
        >
          <fieldset disabled={off} class="contents">
            <RadioGroup
              value={t.priority}
              onValueChange={(priority) =>
                setTransparency({ priority: priority === "global" ? "global" : "parts" })
              }
              aria-label="Transparency priority"
              class="flex flex-wrap gap-1.5"
            >
              {(["global", "parts"] as const).map((priority) => (
                <RadioGroupItem
                  key={priority}
                  value={priority}
                  class="flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary"
                >
                  <RadioIndicator checked={t.priority === priority} />
                  {priority === "global" ? "Global" : "By part"}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </fieldset>
        </SettingsRow>
        <OpacitySlider
          id="transparency-overall"
          label="Global opacity"
          value={t.overall}
          min={OVERALL_MIN}
          disabled={off || t.priority !== "global"}
          onChange={(overall) => setTransparency({ overall })}
        />
      </SettingsSection>
      <SettingsSection title="Opacity by part">
        <SettingsRow
          label="Title bar matches sidebar"
          hint="The title bar uses the sidebar's opacity. Over a top dock, both read as one bar."
        >
          <Toggle
            checked={t.headerFollowsSidebar}
            disabled={off || t.priority !== "parts"}
            onCheckedChange={(headerFollowsSidebar) => setTransparency({ headerFollowsSidebar })}
            aria-label="Title bar matches sidebar"
          />
        </SettingsRow>
        <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2" aria-label="Opacity by part" role="group">
          {PARTS.map(({ key, label }) => {
            const follows = key === "header" && t.headerFollowsSidebar;
            return (
              <OpacitySlider
                key={key}
                id={`transparency-${key}`}
                label={follows ? `${label} (follows sidebar)` : label}
                value={follows ? t.surfaces.sidebar : t.surfaces[key]}
                min={SURFACE_MIN[key]}
                disabled={off || t.priority !== "parts" || follows}
                onChange={(value) => setTransparency({ surfaces: { ...t.surfaces, [key]: value } })}
              />
            );
          })}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
