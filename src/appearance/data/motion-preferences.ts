// App motion and gem display share the existing persisted preference. System
// motion is the default; an explicit opt-in enables CSS and JS motion together.

export interface GemDisplay {
  heroCard: boolean;
  frozen: boolean;
  forceMotion: boolean;
}

const KEY = "gem-display";
const motionQuery = () =>
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function read(): GemDisplay {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      heroCard: p.heroCard !== false,
      frozen: p.frozen === true,
      forceMotion: p.forceMotion === true,
    };
  } catch {
    return { heroCard: true, frozen: false, forceMotion: false };
  }
}

let state: GemDisplay = read();
const listeners = new Set<() => void>();
const reduced = () => !state.forceMotion && !!motionQuery()?.matches;
const applyMotion = () =>
  document.documentElement.toggleAttribute("data-force-motion", state.forceMotion);
applyMotion(); // before first render, including detached windows and the splash
window.addEventListener("storage", (event) => {
  if (event.key !== KEY && event.key !== null) {
    return;
  }
  state = read();
  applyMotion();
  listeners.forEach((l) => l());
});

export function getGemDisplay(): GemDisplay {
  return state;
}

export function setGemDisplay(patch: Partial<GemDisplay>) {
  state = { ...state, ...patch };
  applyMotion();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* no storage */
  }
  listeners.forEach((l) => l());
}

export const toggleHeroCard = () => setGemDisplay({ heroCard: !state.heroCard });
export const toggleFrozen = () =>
  state.frozen || reduced()
    ? setGemDisplay({ frozen: false, forceMotion: true })
    : setGemDisplay({ frozen: true });
export const useSystemMotion = () => setGemDisplay({ frozen: false, forceMotion: false });

export const isAppMotionReduced = reduced;

export function subscribeGemDisplay(l: () => void) {
  const media = motionQuery();
  listeners.add(l);
  if (media?.addEventListener) {
    media.addEventListener("change", l);
  } else {
    media?.addListener?.(l);
  }
  return () => {
    listeners.delete(l);
    if (media?.removeEventListener) {
      media.removeEventListener("change", l);
    } else {
      media?.removeListener?.(l);
    }
  };
}
