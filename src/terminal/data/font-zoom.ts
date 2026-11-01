// Ctrl + / - / 0 font zoom for terminal (TUI) and chat views — terminal-emulator style.
// One shared font size for the whole app; terminals apply it to xterm, chat as CSS zoom.
import { handleBinding } from "@/keybindings/data/keybindings";

const BASE_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
const STORAGE_KEY = "panel-font-size";

export const BASE_FONT = BASE_FONT_SIZE;

let fontSize = (() => {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if (n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) {
      return n;
    }
  } catch {
    /* no storage (tests) */
  }
  return BASE_FONT_SIZE;
})();

export function getFontScale(): number {
  return fontSize / BASE_FONT_SIZE;
}

/** Current persisted font size — for constructors (xterm born at the right size,
 *  no pre-open option mutation on reattach/new tabs). */
export function getFontSize(): number {
  return fontSize;
}

const listeners = new Set<(fs: number) => void>();

function apply(n: number) {
  fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n));
  try {
    localStorage.setItem(STORAGE_KEY, String(fontSize));
  } catch {
    /* no storage */
  }
  for (const fn of listeners) {
    fn(fontSize);
  }
}

export function subscribeFontSize(fn: (fs: number) => void): () => void {
  initFontZoom();
  listeners.add(fn);
  fn(fontSize);
  return () => {
    listeners.delete(fn);
  };
}

let initialized = false;

// Capture on window so it runs before xterm's own keydown — the PTY must
// never see the zoom keystrokes.
export function initFontZoom(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  const handler = (e: KeyboardEvent) => {
    if (handleBinding(e, "fontIncrease", () => apply(fontSize + 1))) {
      return;
    }
    if (handleBinding(e, "fontDecrease", () => apply(fontSize - 1))) {
      return;
    }
    handleBinding(e, "fontReset", () => apply(BASE_FONT_SIZE));
  };
  window.addEventListener("keydown", handler, true);
  window.addEventListener("keydown", handler);
}

export const FONT_SIZE_RANGE = { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, base: BASE_FONT_SIZE };

/** Programmatic counterpart of Ctrl + / - / 0 (Settings dialog). */
export function setFontSize(n: number): void {
  apply(n);
}
