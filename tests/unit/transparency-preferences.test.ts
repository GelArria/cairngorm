import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSPARENCY,
  normalizeTransparency,
  surfaceAlpha,
  SURFACE_KEYS,
} from "@/appearance/model/transparency-preferences";

describe("transparency preferences", () => {
  it("falls back to opaque defaults for missing or corrupt data", () => {
    expect(normalizeTransparency(null)).toEqual(DEFAULT_TRANSPARENCY);
    expect(normalizeTransparency({ enabled: "yes", material: "glass", overall: "x" })).toEqual(
      DEFAULT_TRANSPARENCY,
    );
  });

  it("clamps each part and the overall level", () => {
    const t = normalizeTransparency({
      enabled: true,
      overall: 2,
      surfaces: { terminal: 140, sidebar: -5, overlays: 0 },
    });
    expect(t.overall).toBe(10);
    expect(t.surfaces.terminal).toBe(100);
    expect(t.surfaces.sidebar).toBe(0);
    // Menus and dialogs (Settings included) never become unreadable.
    expect(t.surfaces.overlays).toBe(30);
    expect(t.surfaces.header).toBe(DEFAULT_TRANSPARENCY.surfaces.header);
  });

  it("lets the title bar follow the sidebar unless the user separates them", () => {
    const t = normalizeTransparency({ enabled: true, surfaces: { header: 90, sidebar: 40 } });
    expect(t.headerFollowsSidebar).toBe(true);
    expect(surfaceAlpha(t, "header")).toBeCloseTo(0.4);
    const own = normalizeTransparency({ ...t, headerFollowsSidebar: false });
    expect(surfaceAlpha(own, "header")).toBeCloseTo(0.9);
  });

  it("defaults missing or invalid priority to per-part opacity", () => {
    expect(normalizeTransparency({ priority: "unknown" }).priority).toBe("parts");
    expect(normalizeTransparency({ overall: 50 }).priority).toBe("parts");
  });

  it("ignores overall opacity when per-part opacity has priority", () => {
    for (const overall of [10, 50, 100]) {
      const t = normalizeTransparency({
        enabled: true,
        priority: "parts",
        overall,
        surfaces: { terminal: 40 },
      });
      expect(surfaceAlpha(t, "terminal")).toBeCloseTo(0.4);
    }
  });

  it("uses only overall opacity when global has priority without losing part levels", () => {
    const t = normalizeTransparency({
      enabled: true,
      priority: "global",
      overall: 100,
      surfaces: { terminal: 40, sidebar: 0 },
    });
    expect(t.priority).toBe("global");
    for (const key of SURFACE_KEYS) {
      expect(surfaceAlpha(t, key)).toBe(1);
      expect(surfaceAlpha({ ...t, overall: 50 }, key)).toBe(0.5);
      expect(surfaceAlpha({ ...t, enabled: false }, key)).toBe(1);
    }
    expect(surfaceAlpha({ ...t, priority: "parts" }, "terminal")).toBe(0.4);
    expect(surfaceAlpha({ ...t, priority: "parts", enabled: false }, "terminal")).toBe(1);
  });
});
