import { tagHex } from "@/appearance/model/tag-colors";
import type { Project } from "@/projects/model/project-types";

export interface Stone {
  id: string;
  name: string;
  /** gem lines + accent */ color: string;
}

/** Smoky quartz first: the Cairngorm brand stone (#d9c4a8). */
export const STONES: Stone[] = [
  { id: "quartz", name: "Smoky Quartz", color: "#d9c4a8" },
  { id: "sapphire", name: "Sapphire", color: "#8ab4ff" },
  { id: "amethyst", name: "Amethyst", color: "#c4a1ff" },
  { id: "emerald", name: "Emerald", color: "#6ee7b7" },
  { id: "ruby", name: "Ruby", color: "#ff8a9a" },
  { id: "citrine", name: "Citrine", color: "#ffd166" },
  { id: "aquamarine", name: "Aquamarine", color: "#7ee6f2" },
  { id: "rose", name: "Rose Quartz", color: "#ffb3d1" },
  { id: "onyx", name: "Onyx", color: "#c9ced6" },
  // Added later: never picked as a default, so existing projects keep their stone.
  { id: "garnet", name: "Garnet", color: "#d63a52" },
  { id: "topaz", name: "Topaz", color: "#ff9a4d" },
  { id: "peridot", name: "Peridot", color: "#b5e67a" },
  { id: "jade", name: "Jade", color: "#2fa86e" },
  { id: "tanzanite", name: "Tanzanite", color: "#8e8cff" },
  { id: "lapis", name: "Lapis", color: "#4166e8" },
  { id: "tourmaline", name: "Tourmaline", color: "#f07ad6" },
];

/** Stones a project can get by default. Fixed: growing it would recolour existing projects. */
const DEFAULT_STONES = [
  "quartz",
  "sapphire",
  "amethyst",
  "emerald",
  "ruby",
  "citrine",
  "aquamarine",
  "rose",
  "onyx",
].map((id) => STONES.find((s) => s.id === id)!);

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h | 0;
}

/** Stable default per project: the same id always lands on the same stone. */
export function defaultStone(id: string): Stone {
  return DEFAULT_STONES[Math.abs(hashString(id)) % DEFAULT_STONES.length];
}

/** The project's own resting angle for its gem (so no two tiles look identical). */
export function gemYaw(id: string): number {
  return ((Math.abs(hashString(id + "#yaw")) % 360) / 360) * Math.PI * 2;
}

/** Backdrop lit only from where the gem sits (right), in the stone's colour. */
export function stoneBackdrop(color: string): string {
  return `radial-gradient(80% 115% at 88% 45%, ${color}38 0%, ${color}10 40%, transparent 70%), linear-gradient(160deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)`;
}

export type ParsedBg =
  | { kind: "stone"; stone: Stone }
  | { kind: "image"; path: string }
  | { kind: "none" };

/** "preset:<stone id>" | "image:<path>" | "none" | unset (= the project's default stone). */
export function parseBackground(p: Pick<Project, "id" | "background">): ParsedBg {
  const bg = p.background;
  if (bg === "none") {
    return { kind: "none" };
  }
  if (bg?.startsWith("image:")) {
    return { kind: "image", path: bg.slice(6) };
  }
  const stone = bg?.startsWith("preset:") ? STONES.find((x) => x.id === bg.slice(7)) : undefined;
  return { kind: "stone", stone: stone ?? defaultStone(p.id) };
}

/** Selected label colour overrides the stone's gem + accent, including image backdrops. */
export function projectStone(p: Pick<Project, "id" | "background" | "color">): Stone {
  const parsed = parseBackground(p);
  const stone = parsed.kind === "stone" ? parsed.stone : defaultStone(p.id);
  const color = tagHex(p.color);
  return color ? { ...stone, color } : stone;
}
