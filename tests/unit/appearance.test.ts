import { describe, it, expect, vi } from "vitest";
import { brightness, contrastRatio, hsl, isHex } from "@/appearance/model/colors";
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  readAppearance,
  APPEARANCE_KEY,
} from "@/appearance/model/preferences";
import { THEME_PRESETS } from "@/appearance/model/presets";
import { appearanceTokens, resolvePalette } from "@/appearance/model/tokens";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
});

describe("appearance preferences", () => {
  it("recovers from corrupt or legacy values and only accepts bounded numbers and hex colors", () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance({ preset: "missing", mode: "invalid", contrast: Infinity, colors: null }),
    ).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance({
        contrast: 200,
        textBrightness: -1,
        iconBrightness: NaN,
        colors: { foreground: "#123abc", background: "url(evil)", icons: "red" },
      }),
    ).toMatchObject({
      contrast: 150,
      textBrightness: 70,
      iconBrightness: 100,
      colors: { foreground: "#123abc" },
    });
    localStorage.setItem(APPEARANCE_KEY, "broken json");
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    localStorage.removeItem(APPEARANCE_KEY);
  });

  it("provides unique light and dark palettes with readable primary and secondary text", () => {
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
    expect(new Set(THEME_PRESETS.map((p) => p.name)).size).toBe(THEME_PRESETS.length);
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(150);
    expect(THEME_PRESETS.filter((p) => p.mode === "light").length).toBeGreaterThanOrEqual(80);
    expect(THEME_PRESETS.filter((p) => p.mode === "dark").length).toBeGreaterThanOrEqual(80);
    for (const theme of THEME_PRESETS) {
      const p = resolvePalette({ ...DEFAULT_APPEARANCE, preset: theme.id });
      expect.soft(contrastRatio(p.background, p.foreground), theme.name).toBeGreaterThanOrEqual(7);
      expect
        .soft(contrastRatio(p.card, p.muted), `${theme.name} secondary text`)
        .toBeGreaterThanOrEqual(4.5);
      expect
        .soft(contrastRatio(p.accent, p.onAccent), `${theme.name} buttons`)
        .toBeGreaterThanOrEqual(4.5);
      expect
        .soft(contrastRatio(p.background, p.accent), `${theme.name} accent text`)
        .toBeGreaterThanOrEqual(4.5);
      expect(p.dark).toBe(theme.mode === "dark");
    }
  });

  it("keeps selected appearance or follows system changes with compatible defaults", () => {
    expect(resolvePalette({ ...DEFAULT_APPEARANCE, preset: "paper" }, true).theme.id).toBe("paper");
    const p = { ...DEFAULT_APPEARANCE, preset: "paper", mode: "system" as const };
    expect(resolvePalette(p, false).theme.id).toBe("paper");
    expect(resolvePalette(p, true).theme.id).toBe("cairngorm");
    expect(resolvePalette({ ...p, preset: "nord" }, false).theme.id).toBe("white");
  });

  it("changes the intended colors independently and restores exact defaults", () => {
    const base = resolvePalette(DEFAULT_APPEARANCE);
    const text = resolvePalette({ ...DEFAULT_APPEARANCE, textBrightness: 70 });
    expect(text.background).toBe(base.background);
    expect(text.foreground).not.toBe(base.foreground);
    const border = resolvePalette({ ...DEFAULT_APPEARANCE, borderVisibility: 200 });
    expect(border.foreground).toBe(base.foreground);
    expect(contrastRatio(border.background, border.border)).toBeGreaterThan(
      contrastRatio(base.background, base.border),
    );
    const custom = appearanceTokens({
      ...DEFAULT_APPEARANCE,
      iconBrightness: 125,
      colors: { accent: "#ff0000", icons: "#00ff00" },
    });
    expect(custom["--primary"]).toBe(hsl("#ff0000"));
    expect(custom["--ui-icon-color"]).toBe("#00ff00");
    expect(custom["--ui-icon-brightness"]).toBe("1.25");
    expect(custom["--background"]).toBe(appearanceTokens(DEFAULT_APPEARANCE)["--background"]);
    expect(brightness("#ffffff", 100)).toBe("#ffffff");
    expect(isHex("#123456;")).toBe(false);
  });

  it("applies, persists, synchronizes windows and notifies renderers without reload", async () => {
    const store = await import("@/appearance/data/store");
    store.selectTheme("white");
    expect(document.documentElement.dataset.theme).toBe("white");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    let notifications = 0;
    const un = store.subscribeAppearance(() => notifications++);
    store.setAppearance({ colors: { icons: "#336699" }, iconBrightness: 130 });
    expect(document.documentElement.hasAttribute("data-custom-icons")).toBe(true);
    expect(readAppearance().iconBrightness).toBe(130);
    store.resetAppearance();
    expect(store.getAppearance()).toEqual({ ...DEFAULT_APPEARANCE, preset: "white" });
    expect(document.documentElement.hasAttribute("data-custom-icons")).toBe(false);
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ preset: "nord" }));
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY }));
    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(notifications).toBe(3);
    un();
    const { terminalTheme } = await import("@/appearance/model/terminal-theme");
    for (const preset of THEME_PRESETS) {
      store.selectTheme(preset.id);
      const theme = terminalTheme();
      expect
        .soft(contrastRatio(theme.background!, theme.white!), `${preset.name} ANSI white`)
        .toBeGreaterThanOrEqual(4.5);
      expect
        .soft(
          contrastRatio(theme.background!, theme.brightWhite!),
          `${preset.name} ANSI bright white`,
        )
        .toBeGreaterThanOrEqual(4.5);
    }
    store.selectTheme("cairngorm");
  });
});
