import { clamp, isHex } from "./colors";
import { getPreset } from "./presets";

export const APPEARANCE_KEY = "cairngorm-appearance";
export const COLOR_KEYS = ["background", "foreground", "accent", "icons", "border"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export interface Appearance {
  preset: string;
  mode: "preset" | "system";
  contrast: number;
  surfaceBrightness: number;
  textBrightness: number;
  iconBrightness: number;
  borderVisibility: number;
  colors: Partial<Record<ColorKey, string>>;
}

export const DEFAULT_APPEARANCE: Appearance = {
  preset: "cairngorm",
  mode: "preset",
  contrast: 100,
  surfaceBrightness: 100,
  textBrightness: 100,
  iconBrightness: 100,
  borderVisibility: 100,
  colors: {},
};

export function normalizeAppearance(value: unknown): Appearance {
  const p = value && typeof value === "object" ? (value as Partial<Appearance>) : {};
  const number = (key: keyof Appearance, min: number, max: number) =>
    typeof p[key] === "number" && Number.isFinite(p[key]) ? clamp(p[key] as number, min, max) : 100;
  const colors: Appearance["colors"] = {};
  for (const key of COLOR_KEYS) {
    if (isHex(p.colors?.[key])) {
      colors[key] = p.colors[key];
    }
  }
  return {
    preset: getPreset(typeof p.preset === "string" ? p.preset : "cairngorm").id,
    mode: p.mode === "system" ? "system" : "preset",
    contrast: number("contrast", 75, 150),
    surfaceBrightness: number("surfaceBrightness", 80, 120),
    textBrightness: number("textBrightness", 70, 130),
    iconBrightness: number("iconBrightness", 50, 150),
    borderVisibility: number("borderVisibility", 50, 200),
    colors,
  };
}

export function readAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_APPEARANCE, colors: {} };
  }
}
