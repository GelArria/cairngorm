import { getAppearancePalette, setAppearance } from "@/appearance/data/store";
import { useAppearance } from "@/appearance/hooks/use-appearance";
import { isHex } from "@/appearance/model/colors";
import type { Appearance, ColorKey } from "@/appearance/model/preferences";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Slider } from "@/common/ui/slider";
import { useEffect, useState } from "preact/hooks";

function ColorControl({
  name,
  colorKey,
  fallback,
}: {
  name: string;
  colorKey: ColorKey;
  fallback: string;
}) {
  const p = useAppearance();
  const value = p.colors[colorKey] ?? fallback;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const change = (color: string) => setAppearance({ colors: { ...p.colors, [colorKey]: color } });
  const reset = () => {
    const colors = { ...p.colors };
    delete colors[colorKey];
    setAppearance({ colors });
  };
  return (
    <div class="flex items-center gap-2">
      <Label for={`color-${colorKey}`} class="flex-1 text-xs font-normal">
        {name}
      </Label>
      <Input
        type="color"
        aria-label={`${name} color picker`}
        class="h-7 w-8 cursor-pointer p-0.5"
        value={value}
        onInput={(e) => change(e.currentTarget.value)}
      />
      <Input
        id={`color-${colorKey}`}
        aria-label={`${name} color`}
        class="h-7 w-[82px] px-2 font-mono text-[11px]"
        value={draft}
        maxLength={7}
        spellcheck={false}
        onInput={(e) => {
          const next = e.currentTarget.value;
          setDraft(next);
          if (isHex(next)) {
            change(next);
          }
        }}
        onBlur={() => setDraft(value)}
      />
      <Button
        variant="subtle"
        size="icon-sm"
        aria-label={`Use theme ${name.toLowerCase()}`}
        disabled={!p.colors[colorKey]}
        onClick={reset}
      >
        <Icon name="x" />
      </Button>
    </div>
  );
}

const ADJUSTMENTS = [
  { key: "contrast", label: "UI contrast", min: 75, max: 150 },
  { key: "surfaceBrightness", label: "Background brightness", min: 80, max: 120 },
  { key: "textBrightness", label: "Text brightness", min: 70, max: 130 },
  { key: "iconBrightness", label: "Icon & tick brightness", min: 50, max: 150 },
  { key: "borderVisibility", label: "Border & line visibility", min: 50, max: 200 },
] as const;

export function AppearanceControls() {
  const p = useAppearance();
  const c = getAppearancePalette();
  return (
    <>
      <section class="space-y-2" aria-label="Custom colors">
        <h4 class="mb-2 text-[13px] font-semibold">Colors</h4>
        <ColorControl name="Background" colorKey="background" fallback={c.theme.background} />
        <ColorControl name="Text" colorKey="foreground" fallback={c.theme.foreground} />
        <ColorControl name="Accent" colorKey="accent" fallback={c.theme.accent} />
        <ColorControl name="Icons & ticks" colorKey="icons" fallback={c.theme.foreground} />
        <ColorControl name="Borders & lines" colorKey="border" fallback={c.theme.border} />
      </section>
      <section class="mt-4 space-y-2" aria-label="Visibility adjustments">
        <h4 class="text-[13px] font-semibold">Contrast & brightness</h4>
        {ADJUSTMENTS.map(({ key, label, min, max }) => (
          <div key={key}>
            <div class="mb-1 flex items-center justify-between">
              <Label for={`appearance-${key}`} class="text-[11px] font-normal">
                {label}
              </Label>
              <output
                for={`appearance-${key}`}
                class="font-mono text-[11px] tabular-nums text-muted-foreground"
              >
                {p[key]}%
              </output>
            </div>
            <Slider
              id={`appearance-${key}`}
              min={min}
              max={max}
              step={1}
              value={p[key]}
              onValueChange={(value) => setAppearance({ [key]: value } as Partial<Appearance>)}
            />
          </div>
        ))}
      </section>
    </>
  );
}
