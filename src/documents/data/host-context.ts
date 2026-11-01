// Theme and environment a provider view can use to match the pane it lives in.
import { getAppearancePalette } from "@/appearance/data/store";

const COLOR_TOKENS = {
  background: "--background",
  foreground: "--foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  accent: "--primary",
} as const;

export function hostTheme() {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(
    Object.entries(COLOR_TOKENS).map(([name, token]) => {
      const value = style.getPropertyValue(token).trim();
      return [name, value ? `hsl(${value})` : ""];
    }),
  );
  return { theme: getAppearancePalette().dark ? "dark" : "light", colors };
}

export function hostContext(container: HTMLElement | null) {
  return {
    ...hostTheme(),
    containerDimensions: {
      width: container?.clientWidth ?? 0,
      height: container?.clientHeight ?? 0,
    },
    locale: navigator.language,
  };
}
