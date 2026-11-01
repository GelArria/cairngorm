import { preset, type ThemePreset } from "./preset";
import { BASE_PRESETS } from "./presets-base";
import { DARK_EXTRA_PRESETS } from "./presets-dark-extra";
import { GEM_DARK_PRESETS, GEM_LIGHT_PRESETS } from "./presets-gems";
import { LIGHT_EXTRA_PRESETS } from "./presets-light-extra";

export type { ThemePreset } from "./preset";

function fromRows(rows: string[], mode: ThemePreset["mode"]): ThemePreset[] {
  return rows.map((row) => {
    const [id, name, ...colors] = row.split("|");
    return preset(id, name, mode, colors);
  });
}

export const THEME_PRESETS: ThemePreset[] = [
  ...BASE_PRESETS,
  ...fromRows(LIGHT_EXTRA_PRESETS, "light"),
  ...fromRows(DARK_EXTRA_PRESETS, "dark"),
  ...fromRows(GEM_LIGHT_PRESETS, "light"),
  ...fromRows(GEM_DARK_PRESETS, "dark"),
];

export function getPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((theme) => theme.id === id) ?? THEME_PRESETS[0];
}
