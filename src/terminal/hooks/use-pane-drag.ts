import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { holeAt } from "../model/layout/hit-test";
import type { TerminalState } from "../model/types";
import { createPaneDragPreview } from "../runtime/pane-drag-preview";

interface PaneDragOptions {
  gridRef: RefObject<HTMLDivElement>;
  holeGlowRef: RefObject<HTMLDivElement>;
  state: TerminalState;
  zoomedTabId: string | null;
  handleDetach: (id: string) => void;
  moveCell: (id: string, col: number, row: number) => void;
  swapCells: (a: string, b: string) => void;
}

export function usePaneDrag({
  gridRef,
  holeGlowRef,
  state,
  zoomedTabId,
  handleDetach,
  moveCell,
  swapCells,
}: PaneDragOptions) {
  // ── Pane drag & drop: move to gap (fit+stretch), swap with another pane,
  //    or tear-off outside the window. Listener in CAPTURE PHASE on the
  //    grid (the xterm consumes mousedown for selection; in capture we arrive
  //    first). Ghost + highlight of the target gap. ──
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    let activeCleanup: (() => void) | null = null;
    const onDown = (e: MouseEvent) => {
      // Content gestures belong to xterm/CodeMirror: drag only the explicit grip.
      if (zoomedTabId || e.button !== 0 || !(e.target as Element)?.closest?.("[data-pane-drag]")) {
        return;
      }
      // The resizer and detach button live INSIDE the pane: their grab is not a
      // pane-drag (and the drag move stopPropagation would kill their
      // bubble listeners — the resizer’s — and steal the button click).
      if (
        (e.target as HTMLElement)?.closest?.("[data-col-resizer],[data-row-resizer],[data-no-drag]")
      ) {
        return;
      }
      const paneEl = (e.target as HTMLElement)?.closest?.("[data-pane-id]") as HTMLElement | null;
      if (!paneEl) {
        return;
      }
      const tabId = paneEl.getAttribute("data-pane-id")!;
      const layout = state.layout;
      if (!layout) {
        return;
      }
      const startX = e.clientX,
        startY = e.clientY;
      let dragging = false;
      const glow = holeGlowRef.current;

      const { clear: clearPreview, show: showPreview } = createPaneDragPreview(paneEl);
      // Snip Tool / alt-tab steal input mid-drag: the mouseup lands in
      // another process and the drag stays alive (phantom drop with stale coords).
      // Central cancellation: cleanup of listeners + visuals, no drop.
      const cleanupDrag = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("blur", onBlur);
        paneEl.style.transform = "";
        paneEl.classList.remove("pane-dragging");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (glow) {
          glow.classList.add("hidden");
        }
        clearPreview();
        window.getSelection()?.removeAllRanges();
      };
      const onBlur = () => cleanupDrag();

      const onMove = (ev: MouseEvent) => {
        // Mousemove without button = the mouseup was lost (system overlay) → cancel
        if (ev.buttons === 0) {
          cleanupDrag();
          return;
        }
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
          dragging = true;
          ev.preventDefault();
          // Capture on document runs BEFORE the xterm bubble listeners:
          // stopPropagation freezes its drag-selection (otherwise it re-creates it on every move).
          ev.stopPropagation();
          window.getSelection()?.removeAllRanges(); // kill the selection the xterm started
          // The REAL pane is grabbed: translate = the grab point stays
          // under the mouse (floating-window feel, not a ghost).
          paneEl.classList.add("pane-dragging");
          paneEl.style.transform = "translate(0px, 0px)";
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        if (!dragging) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation(); // the xterm must not extend its selection during the drag
        window.getSelection()?.removeAllRanges();
        paneEl.style.transform = `translate(${ev.clientX - startX}px, ${ev.clientY - startY}px)`;
        const hole = holeAt(ev, grid, layout);
        if (glow) {
          if (hole) {
            glow.classList.remove("hidden");
            clearPreview();
            glow.style.left = hole.x + "px";
            glow.style.top = hole.y + "px";
            glow.style.width = hole.w + "px";
            glow.style.height = hole.h + "px";
            paneEl.classList.add("swap-contact"); // gap contact: transparent
          } else {
            glow.classList.add("hidden");
            const t = document
              .elementFromPoint(ev.clientX, ev.clientY)
              ?.closest("[data-pane-id]") as HTMLElement | null;
            if (t && t !== paneEl) {
              showPreview(t);
            } else {
              clearPreview();
            }
          }
        }
      };

      const onUp = (ev: MouseEvent) => {
        cleanupDrag();
        if (ev.button !== 0) {
          return;
        } // coordinated release: cancel, never drop
        if (!dragging) {
          return;
        } // normal click: the xterm/pane handle it
        ev.preventDefault();
        const outside =
          ev.clientX < 0 ||
          ev.clientX > window.innerWidth ||
          ev.clientY < 0 ||
          ev.clientY > window.innerHeight;
        if (outside) {
          if (state.tabs.find((x) => x.id === tabId)?.kind !== "file") {
            handleDetach(tabId);
          }
          return;
        }
        const hole = holeAt(ev, grid, layout);
        if (hole) {
          moveCell(tabId, hole.col, hole.row);
          return;
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-pane-id]");
        const targetId = el?.getAttribute("data-pane-id");
        if (targetId && targetId !== tabId) {
          swapCells(tabId, targetId);
        }
      };

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      window.addEventListener("blur", onBlur);
      activeCleanup = cleanupDrag;
    };

    grid.addEventListener("mousedown", onDown, true);
    return () => {
      grid.removeEventListener("mousedown", onDown, true);
      // Unmount mid-drag (e.g. pty-kill of the grabbed tab): without this
      // the document listeners survive and the pane stays lifted
      // (transform + userSelect:none) until the next mouse event.
      // On deps-change the grid is still connected → the live drag continues.
      if (!grid.isConnected) {
        activeCleanup?.();
      }
    };
  }, [state.layout, state.tabs, zoomedTabId]);
}
