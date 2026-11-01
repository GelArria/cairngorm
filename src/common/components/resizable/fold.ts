// Folding: dragging a panel's edge past its minimum width folds it to its collapsed
// rail; dragging the rail's edge outward unfolds it. Pure math, shared by the
// component and its tests.

export type DragMode = "resize" | "collapse" | "expand";

/** Share of the fold distance after which releasing completes the fold. */
export const COLLAPSE_ARM = 0.5;
/** Unfolding asks for less: the rail is a small target to pull from. */
export const EXPAND_ARM = 0.3;

export interface FoldLimits {
  minWidth: number;
  collapsedWidth: number;
}

export interface DragStep {
  mode: DragMode;
  width: number;
}

/**
 * Where a drag that started at `startWidth` is after moving `delta` px outward.
 * `collapsed` drags can only unfold; open panels resize until they pass the
 * minimum, then fold (when folding is allowed).
 */
export function dragStep(
  startWidth: number,
  delta: number,
  limits: FoldLimits,
  options: {
    collapsed: boolean;
    canFold: boolean;
    canUnfold: boolean;
    clamp: (w: number) => number;
  },
): DragStep {
  const { minWidth, collapsedWidth } = limits;
  const raw = startWidth + delta;
  if (options.collapsed) {
    const width = options.canUnfold
      ? Math.min(minWidth, Math.max(collapsedWidth, raw))
      : collapsedWidth;
    return { mode: "expand", width };
  }
  if (raw >= minWidth || !options.canFold) {
    return { mode: "resize", width: options.clamp(raw) };
  }
  return { mode: "collapse", width: Math.max(collapsedWidth, raw) };
}

/** 0 at the open edge of the fold, 1 at the rail. */
export function foldProgress(step: DragStep, limits: FoldLimits): number {
  const span = Math.max(1, limits.minWidth - limits.collapsedWidth);
  if (step.mode === "collapse") {
    return clamp01((limits.minWidth - step.width) / span);
  }
  if (step.mode === "expand") {
    return clamp01((step.width - limits.collapsedWidth) / span);
  }
  return 0;
}

/** Whether releasing now completes the fold (or unfold). */
export function isArmed(step: DragStep, limits: FoldLimits): boolean {
  const progress = foldProgress(step, limits);
  if (step.mode === "collapse") {
    return progress >= COLLAPSE_ARM;
  }
  if (step.mode === "expand") {
    return progress >= EXPAND_ARM;
  }
  return false;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
