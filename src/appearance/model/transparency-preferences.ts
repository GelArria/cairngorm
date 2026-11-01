import { clamp } from "./colors";

export const TRANSPARENCY_KEY = "cairngorm-transparency";

/** App parts that each keep their own opacity. */
export const SURFACE_KEYS = [
  "header",
  "sidebar",
  "tabs",
  "terminal",
  "panels",
  "overlays",
] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];

/** blur = Acrylic (Windows) / HUD vibrancy (macOS); mica = Mica / under-window vibrancy. */
export const MATERIALS = ["blur", "mica", "clear"] as const;
export type Material = (typeof MATERIALS)[number];

export interface Transparency {
  enabled: boolean;
  material: Material;
  priority: "global" | "parts";
  /** Uniform opacity when global has priority, in percent (100 = solid). */
  overall: number;
  /** Opacity per part, in percent (100 = solid). */
  surfaces: Record<SurfaceKey, number>;
  /** The title bar uses the sidebar's opacity, so the window frame reads as one surface. */
  headerFollowsSidebar: boolean;
}

export const OVERALL_MIN = 10;
/** Lowest opacity per part: menus and dialogs (Settings included) stay readable. */
export const SURFACE_MIN: Record<SurfaceKey, number> = {
  header: 0,
  sidebar: 0,
  tabs: 0,
  terminal: 0,
  panels: 0,
  overlays: 30,
};

export const DEFAULT_TRANSPARENCY: Transparency = {
  enabled: false,
  material: "blur",
  priority: "parts",
  overall: 100,
  surfaces: { header: 80, sidebar: 75, tabs: 80, terminal: 75, panels: 88, overlays: 92 },
  headerFollowsSidebar: true,
};

const percent = (value: unknown, fallback: number, min: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? clamp(Math.round(value), min, 100)
    : fallback;

export function normalizeTransparency(value: unknown): Transparency {
  const p = value && typeof value === "object" ? (value as Partial<Transparency>) : {};
  const surfaces = {} as Transparency["surfaces"];
  for (const key of SURFACE_KEYS) {
    surfaces[key] = percent(
      p.surfaces?.[key],
      DEFAULT_TRANSPARENCY.surfaces[key],
      SURFACE_MIN[key],
    );
  }
  return {
    enabled: p.enabled === true,
    material: MATERIALS.includes(p.material as Material) ? (p.material as Material) : "blur",
    priority: p.priority === "global" ? "global" : "parts",
    overall: percent(p.overall, 100, OVERALL_MIN),
    surfaces,
    headerFollowsSidebar: p.headerFollowsSidebar !== false,
  };
}

export function readTransparency(): Transparency {
  try {
    return normalizeTransparency(JSON.parse(localStorage.getItem(TRANSPARENCY_KEY) ?? "null"));
  } catch {
    return normalizeTransparency(null);
  }
}

/** Final 0–1 alpha a part paints with. */
export function surfaceAlpha(t: Transparency, key: SurfaceKey): number {
  const part = key === "header" && t.headerFollowsSidebar ? "sidebar" : key;
  return t.enabled ? (t.priority === "global" ? t.overall : t.surfaces[part]) / 100 : 1;
}
