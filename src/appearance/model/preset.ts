export interface ThemePreset {
  id: string;
  name: string;
  mode: "light" | "dark";
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
}

export function preset(
  id: string,
  name: string,
  mode: ThemePreset["mode"],
  colors: string[],
): ThemePreset {
  const [background, card, foreground, muted, border, accent] = colors;
  return { id, name, mode, background, card, foreground, muted, border, accent };
}
