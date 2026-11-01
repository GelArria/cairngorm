import type { TileLayout } from "../types";

export function getRowRatios(layout: TileLayout): number[] {
  const count = Math.max(1, ...layout.cells.map((c) => c.row + c.rowSpan));
  return Array.from({ length: count }, (_, i) => layout.rowRatios?.[i] ?? 1);
}

/** Transfer space between adjacent tracks without changing the total size. */
export function resizeTrackRatios(
  ratios: number[],
  index: number,
  deltaPx: number,
  containerPx: number,
): number[] {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ratios.length - 1 ||
    !Number.isFinite(deltaPx) ||
    !Number.isFinite(containerPx) ||
    containerPx <= 0
  ) {
    return ratios;
  }
  const total = ratios.reduce((a, b) => a + b, 0);
  const pair = ratios[index] + ratios[index + 1];
  const minimum = Math.min((40 / containerPx) * total, pair / 2);
  const first = Math.max(
    minimum,
    Math.min(pair - minimum, ratios[index] + (deltaPx / containerPx) * total),
  );
  const resized = [...ratios];
  resized[index] = first;
  resized[index + 1] = pair - first;
  return resized;
}
