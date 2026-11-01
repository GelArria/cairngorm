// Minimal label colours for conversations and terminal groups: muted, all at
// the same lightness. No green or yellow — those hues are reserved for agent
// status (available / running).
export const TAG_COLORS = [
  { id: "clay", label: "Clay", hex: "#cf8a6d" },
  { id: "rose", label: "Rose", hex: "#d4879a" },
  { id: "plum", label: "Plum", hex: "#b78ad2" },
  { id: "iris", label: "Iris", hex: "#8f95dd" },
  { id: "sky", label: "Sky", hex: "#6fa6d8" },
  { id: "teal", label: "Teal", hex: "#5badb6" },
  { id: "stone", label: "Stone", hex: "#a8a29e" },
  // Appended: order drives automatic split-group colours.
  { id: "orchid", label: "Orchid", hex: "#c886bf" },
  { id: "sand", label: "Sand", hex: "#c4ab8c" },
  { id: "slate", label: "Slate", hex: "#8796ad" },
  { id: "brick", label: "Brick", hex: "#d27a74" },
  { id: "cobalt", label: "Cobalt", hex: "#7b9be0" },
] as const;

export type TagColor = (typeof TAG_COLORS)[number]["id"];

export function tagHex(color: string | null | undefined): string | undefined {
  return TAG_COLORS.find((c) => c.id === color)?.hex;
}
