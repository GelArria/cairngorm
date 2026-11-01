import { brightness, contrastRatio, hsl, luminance, mix } from "./colors";
import type { Appearance } from "./preferences";
import { getPreset } from "./presets";

const AA = 4.5;

/**
 * Moves `color` toward `toward` in 5% steps until it reads at AA on every surface.
 * Never past 85%: secondary text must stay distinguishable from body text.
 */
export function readable(color: string, toward: string, surfaces: string[]): string {
  const ok = (c: string) => surfaces.every((s) => contrastRatio(c, s) >= AA + 0.05);
  for (let t = 0; t <= 0.85 + 1e-9; t += 0.05) {
    const candidate = mix(color, toward, t);
    if (ok(candidate)) {
      return candidate;
    }
  }
  return mix(color, toward, 0.85);
}

export function resolvePalette(p: Appearance, systemDark = false) {
  const selected = getPreset(p.preset);
  const theme =
    p.mode === "system" && (selected.mode === "dark") !== systemDark
      ? getPreset(systemDark ? "cairngorm" : "white")
      : selected;
  const background = brightness(p.colors.background ?? theme.background, p.surfaceBrightness);
  const dark = luminance(background) < 0.35;
  const card = p.colors.background
    ? mix(background, dark ? "#ffffff" : "#000000", 0.035)
    : brightness(theme.card, p.surfaceBrightness);
  const foreground = brightness(
    mix(background, p.colors.foreground ?? theme.foreground, p.contrast / 100),
    p.textBrightness,
  );
  const preset = brightness(mix(background, theme.muted, p.contrast / 100), p.textBrightness);
  // Secondary text stays readable (WCAG AA, 4.5:1) on both page and card surfaces,
  // unless the person lowered contrast on purpose.
  // `secondary` matches appearanceTokens: the hover/muted surface.
  const secondary = mix(background, foreground, dark ? 0.055 : 0.045);
  const muted =
    p.contrast >= 100 ? readable(preset, foreground, [background, card, secondary]) : preset;
  const border = mix(
    background,
    p.colors.border ?? theme.border,
    ((p.borderVisibility / 100) * p.contrast) / 100,
  );
  const accent = p.colors.accent ?? theme.accent;
  const onAccent =
    contrastRatio(accent, "#000000") > contrastRatio(accent, "#ffffff") ? "#000000" : "#ffffff";
  return { theme, dark, background, card, foreground, muted, border, accent, onAccent };
}

export function appearanceTokens(p: Appearance, systemDark = false): Record<string, string> {
  const c = resolvePalette(p, systemDark);
  const secondary = mix(c.background, c.foreground, c.dark ? 0.055 : 0.045);
  const accentBg = mix(c.background, c.accent, c.dark ? 0.16 : 0.1);
  const channels: Record<string, string> = {
    background: c.background,
    foreground: c.foreground,
    card: c.card,
    "card-foreground": c.foreground,
    popover: c.card,
    "popover-foreground": c.foreground,
    primary: c.accent,
    "primary-foreground": c.onAccent,
    secondary,
    "secondary-foreground": c.foreground,
    muted: secondary,
    "muted-foreground": c.muted,
    accent: accentBg,
    "accent-foreground": c.foreground,
    border: c.border,
    input: c.border,
    ring: c.accent,
    destructive: c.dark ? "#ef4444" : "#be2633",
    "destructive-foreground": "#ffffff",
  };
  const tokens = Object.fromEntries(
    Object.entries(channels).map(([key, value]) => [`--${key}`, hsl(value)]),
  );
  return {
    ...tokens,
    "--terminal-background": c.background,
    "--ui-icon-color": p.colors.icons
      ? mix(c.background, p.colors.icons, p.contrast / 100)
      : "currentColor",
    "--ui-icon-brightness": String(p.iconBrightness / 100),
    "--ui-accent-color": c.accent,
    "--syntax-keyword": brightness(c.dark ? "#c4b5fd" : "#7c3ab0", p.textBrightness),
    "--syntax-type": brightness(c.dark ? "#5eead4" : "#087b71", p.textBrightness),
    "--syntax-string": brightness(c.dark ? "#86efac" : "#276a36", p.textBrightness),
    "--syntax-number": brightness(c.dark ? "#fcd34d" : "#966016", p.textBrightness),
    "--syntax-function": brightness(c.dark ? "#7dd3fc" : "#1665a0", p.textBrightness),
    "--syntax-deleted": brightness(c.dark ? "#fca5a5" : "#b52635", p.textBrightness),
  };
}
