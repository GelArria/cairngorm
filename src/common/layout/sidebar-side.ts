// Which edge the sidebar sits on. Singleton + listeners (like font-zoom) so the
// header button, Settings and the layout all stay in sync — useLocalStorage
// instances don't share state.
import { useEffect, useState } from "preact/hooks";

export type SidebarSide = "left" | "right" | "top" | "bottom";
export const SIDEBAR_POSITIONS: { side: SidebarSide; label: string }[] = [
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
  { side: "top", label: "Top" },
  { side: "bottom", label: "Bottom" },
];

const STORAGE_KEY = "sidebar-side";
const listeners = new Set<(s: SidebarSide) => void>();

let side: SidebarSide = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return SIDEBAR_POSITIONS.find((p) => p.side === saved)?.side ?? "bottom";
  } catch {
    return "bottom";
  }
})();

export function getSidebarSide(): SidebarSide {
  return side;
}

export function setSidebarSide(next: SidebarSide): void {
  if (next === side) {
    return;
  }
  side = next;
  try {
    localStorage.setItem(STORAGE_KEY, side);
  } catch {
    /* no storage */
  }
  listeners.forEach((l) => l(side));
}

export function toggleSidebarSide(): void {
  setSidebarSide(
    side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top",
  );
}

export function useSidebarSide(): SidebarSide {
  const [s, setS] = useState(side);
  useEffect(() => {
    setS(side);
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** The edge facing the content — where tooltips and borders go. */
export const innerSide = (s: SidebarSide): SidebarSide =>
  s === "left" ? "right" : s === "right" ? "left" : s === "top" ? "bottom" : "top";
