import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  readAppearance,
  type Appearance,
} from "../model/preferences";
import { appearanceTokens, resolvePalette } from "../model/tokens";

const media =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
let state = readAppearance();
const listeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  const palette = resolvePalette(state, media?.matches);
  root.classList.toggle("dark", palette.dark);
  root.style.colorScheme = palette.dark ? "dark" : "light";
  root.dataset.theme = palette.theme.id;
  root.toggleAttribute("data-custom-icons", !!state.colors.icons);
  for (const [key, value] of Object.entries(appearanceTokens(state, media?.matches))) {
    root.style.setProperty(key, value);
  }
  listeners.forEach((l) => l());
}

apply(); // before main, detached windows and portaled UI render
media?.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key !== APPEARANCE_KEY && event.key !== null) {
    return;
  }
  state = readAppearance();
  apply();
});

export const getAppearance = () => state;
export const getAppearancePalette = () => resolvePalette(state, media?.matches);
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAppearance(patch: Partial<Appearance>) {
  state = normalizeAppearance({ ...state, ...patch });
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(state));
  } catch {
    /* still apply for this window */
  }
  apply();
}

export function selectTheme(preset: string) {
  setAppearance({ ...DEFAULT_APPEARANCE, colors: {}, preset });
}
export function resetAppearance() {
  setAppearance({ ...DEFAULT_APPEARANCE, colors: {}, preset: state.preset, mode: state.mode });
}
