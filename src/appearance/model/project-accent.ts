import { useAppearance } from "@/appearance/hooks/use-appearance";
import { getAppearancePalette } from "../data/store";
import { contrastRatio, mix } from "./colors";

/** Pastel gemstone colors need a darker UI variant on white surfaces. */
export function useProjectAccent(stone: string): string {
  useAppearance();
  const c = getAppearancePalette();
  const target = c.dark ? "#ffffff" : "#000000";
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const color = mix(stone, target, amount);
    if (contrastRatio(color, c.card) >= 4.5) {
      return color;
    }
  }
  return target;
}
