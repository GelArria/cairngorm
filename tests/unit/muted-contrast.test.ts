import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/appearance/model/colors";
import { DEFAULT_APPEARANCE } from "@/appearance/model/preferences";
import { THEME_PRESETS } from "@/appearance/model/presets";
import { resolvePalette } from "@/appearance/model/tokens";

describe("secondary text contrast", () => {
  it.each(THEME_PRESETS.map((t) => [t.name, t.id]))(
    "%s keeps muted text at WCAG AA on page and card",
    (_, id) => {
      const c = resolvePalette({ ...DEFAULT_APPEARANCE, preset: id, colors: {} });
      expect(contrastRatio(c.muted, c.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.muted, c.card)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("respects a contrast the person lowered on purpose", () => {
    const low = resolvePalette({ ...DEFAULT_APPEARANCE, contrast: 60, colors: {} });
    expect(contrastRatio(low.muted, low.background)).toBeLessThan(4.5);
  });
});
