import type { TileLayout } from "../types";
import { getRowRatios } from "./track-sizing";
export const holeAt = (ev: MouseEvent, gridEl: HTMLElement, lay: TileLayout) => {
  const rect = gridEl.getBoundingClientRect();
  const pad = 2;
  const innerW = rect.width - pad * 2,
    innerH = rect.height - pad * 2;
  const ratios = lay.columnRatios;
  const total = ratios.reduce((a, b) => a + b, 0) || 1;
  const maxRow = Math.max(1, ...lay.cells.map((c) => c.row + c.rowSpan));
  const px = ev.clientX - rect.left - pad,
    py = ev.clientY - rect.top - pad;
  const colEdges = [0];
  let acc = 0;
  for (const r of ratios) {
    acc += r;
    colEdges.push((acc / total) * innerW);
  }
  const rowRatios = getRowRatios(lay);
  const rowTotal = rowRatios.reduce((a, b) => a + b, 0);
  const rowEdges = [0];
  acc = 0;
  for (const r of rowRatios) {
    acc += r;
    rowEdges.push((acc / rowTotal) * innerH);
  }
  let col = -1,
    row = -1;
  for (let k = 0; k < ratios.length; k++) {
    if (px >= colEdges[k] && px < colEdges[k + 1]) {
      col = k;
      break;
    }
  }
  for (let r = 0; r < maxRow; r++) {
    if (py >= rowEdges[r] && py < rowEdges[r + 1]) {
      row = r;
      break;
    }
  }
  if (col < 0 || row < 0) {
    return null;
  }
  const occ = new Set<string>();
  for (const c of lay.cells) {
    for (let r = c.row; r < c.row + c.rowSpan; r++) {
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        occ.add(`${k},${r}`);
      }
    }
  }
  if (occ.has(`${col},${row}`)) {
    return null;
  }
  return {
    col,
    row,
    x: pad + colEdges[col],
    y: pad + rowEdges[row],
    w: colEdges[col + 1] - colEdges[col],
    h: rowEdges[row + 1] - rowEdges[row],
  };
};
