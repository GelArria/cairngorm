// Dragging a tab from the bar over the grid: a small ghost of the tab follows
// the pointer and the pane under it lights the zone it would dock into (half
// of the pane for an edge, the whole pane for the centre). Release = dock.
import type { RefObject } from "preact";
import { useCallback, useRef } from "preact/hooks";
import { dockEdgeAt, dockZone, type DockEdge } from "../model/dock-layout";

interface Target {
  paneId: string;
  edge: DockEdge;
}

export function useTabDock(
  areaRef: RefObject<HTMLDivElement>,
  zoneRef: RefObject<HTMLDivElement>,
  dockTab: (dragId: string, targetId: string, edge: DockEdge) => void,
  /** true while the grid is split (several panes on screen) */
  isSplit: () => boolean,
) {
  const target = useRef<Target | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);

  const hideZone = () => {
    zoneRef.current?.classList.add("hidden");
    target.current = null;
  };

  const cancel = useCallback(() => {
    hideZone();
    ghost.current?.remove();
    ghost.current = null;
  }, []);

  const move = useCallback((tabId: string, title: string, x: number, y: number) => {
    if (!ghost.current) {
      const g = document.createElement("div");
      g.className =
        "pointer-events-none fixed z-[70] rounded-md border border-white/15 bg-card/95 px-2 py-1 text-[11px] text-foreground shadow-lg";
      g.textContent = title;
      document.body.appendChild(g);
      ghost.current = g;
    }
    ghost.current.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
    ghost.current.style.left = "0px";
    ghost.current.style.top = "0px";

    const area = areaRef.current,
      zone = zoneRef.current;
    const pane = document.elementFromPoint(x, y)?.closest?.("[data-pane-id]") as HTMLElement | null;
    if (!area || !zone || !pane || !area.contains(pane)) {
      return hideZone();
    }
    const paneId = pane.getAttribute("data-pane-id")!;
    // Over itself: only meaningful in single view (it splits); in a grid the
    // pane is already there — move it by dragging the pane instead
    if (paneId === tabId && isSplit()) {
      return hideZone();
    }
    const r = pane.getBoundingClientRect(),
      a = area.getBoundingClientRect();
    const edge = dockEdgeAt(r, x, y);
    if (paneId === tabId && edge === "center") {
      return hideZone();
    }
    const z = dockZone(edge);
    zone.classList.remove("hidden");
    zone.style.left = `${r.left - a.left + z.x * r.width}px`;
    zone.style.top = `${r.top - a.top + z.y * r.height}px`;
    zone.style.width = `${z.w * r.width}px`;
    zone.style.height = `${z.h * r.height}px`;
    zone.dataset.edge = edge;
    target.current = { paneId, edge };
  }, []);

  /** true when the tab was docked (the caller skips its own drop handling). */
  const drop = useCallback(
    (tabId: string): boolean => {
      const t = target.current;
      cancel();
      if (!t) {
        return false;
      }
      dockTab(tabId, t.paneId, t.edge);
      return true;
    },
    [dockTab],
  );

  return { move, drop, cancel };
}
