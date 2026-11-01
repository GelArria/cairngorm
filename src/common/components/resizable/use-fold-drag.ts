// Drag state machine for a resizable panel edge: resize, fold past the minimum,
// unfold from the collapsed rail. Rendering stays in Resizable.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { dragStep, isArmed, type DragStep, type FoldLimits } from "./fold";

export interface FoldDragOptions {
  side: "left" | "right";
  /** The open width the panel returns to. */
  width: number;
  setWidth: (width: number) => void;
  limits: FoldLimits;
  collapsed: boolean;
  clamp: (width: number) => number;
  onCollapse?: () => void;
  onExpand?: () => void;
  /** Any change cancels an ongoing drag (edge, layout mode). */
  resetKey: unknown;
}

export function useFoldDrag({
  side,
  width,
  setWidth,
  limits,
  collapsed,
  clamp,
  onCollapse,
  onExpand,
  resetKey,
}: FoldDragOptions) {
  const [drag, setDrag] = useState<DragStep | null>(null);
  const dragRef = useRef<DragStep | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    detach.current?.();
    detach.current = null;
    dragRef.current = null;
    setDrag(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => cleanup, [cleanup]);
  // A drag belongs to the state it started in: if the panel collapses, expands or
  // changes layout meanwhile (keyboard, rail button, breakpoint), it is abandoned.
  useEffect(() => {
    cleanup();
  }, [resetKey, collapsed, !!onCollapse, !!onExpand, cleanup]);

  const start = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      cleanup();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const startX = e.clientX;
      const startWidth = collapsed ? limits.collapsedWidth : clamp(width);
      const options = { collapsed, canFold: !!onCollapse, canUnfold: !!onExpand, clamp };
      const finish = (commit: boolean) => {
        const step = dragRef.current;
        if (commit && step && isArmed(step, limits)) {
          if (step.mode === "collapse") {
            onCollapse?.();
          } else if (step.mode === "expand") {
            onExpand?.();
          }
        } else if (commit && step?.mode === "resize") {
          // Keep the live drag in one state update per pointer event. Persist
          // the final width only after release so the parent tree does not
          // render twice for every move.
          setWidth(step.width);
        } else if (step?.mode === "collapse") {
          // A cancelled fold returns to where the drag began, however fast it crossed.
          setWidth(startWidth);
        }
        cleanup();
      };
      const move = (ev: MouseEvent) => {
        // The button was released where we could not see it (another window, a dialog):
        // cancel instead of committing on some later, unrelated click.
        if (ev.buttons === 0) {
          finish(false);
          return;
        }
        const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        const step = dragStep(startWidth, delta, limits, options);
        dragRef.current = step;
        setDrag(step);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("blur", cancel);
      detach.current = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("blur", cancel);
      };
      // No step until the pointer moves: a plain click on the edge changes nothing.
      dragRef.current = { mode: "resize", width: startWidth };
    },
    [
      side,
      width,
      collapsed,
      clamp,
      onCollapse,
      onExpand,
      cleanup,
      limits.minWidth,
      limits.collapsedWidth,
    ],
  );

  return { drag, start };
}
