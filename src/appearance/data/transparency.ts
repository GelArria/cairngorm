import {
  SURFACE_KEYS,
  TRANSPARENCY_KEY,
  normalizeTransparency,
  readTransparency,
  surfaceAlpha,
  type Transparency,
} from "../model/transparency-preferences";
import { getAppearancePalette, subscribeAppearance } from "./store";
import { applyWindowMaterial } from "./window-material";

let state = readTransparency();
const listeners = new Set<() => void>();

/** Every window applies the same settings: CSS alphas plus its own native backdrop. */
function apply() {
  const root = document.documentElement;
  root.toggleAttribute("data-translucent", state.enabled);
  root.toggleAttribute("data-header-follows", state.headerFollowsSidebar);
  for (const key of SURFACE_KEYS) {
    root.style.setProperty(`--alpha-${key}`, String(surfaceAlpha(state, key)));
  }
  applyMaterial();
  listeners.forEach((l) => l());
}

function applyMaterial() {
  void applyWindowMaterial(state.enabled ? state.material : "none", getAppearancePalette().dark);
}

apply(); // before the first paint, like the appearance store
subscribeAppearance(applyMaterial); // light/dark Mica follows the app theme
window.addEventListener("storage", (event) => {
  if (event.key !== TRANSPARENCY_KEY && event.key !== null) {
    return;
  }
  state = readTransparency();
  apply();
});

export const getTransparency = () => state;

export function subscribeTransparency(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTransparency(patch: Partial<Transparency>) {
  state = normalizeTransparency({ ...state, ...patch });
  try {
    localStorage.setItem(TRANSPARENCY_KEY, JSON.stringify(state));
  } catch {
    /* still apply for this window */
  }
  apply();
}
