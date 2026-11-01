import { type TileCell } from "../types";
import { occupancy } from "./geometry";

/** Absorbs ALL holes: every empty cell is covered by growing the adjacent
 *  neighbor above (or to the left when there is no above). Loop until full. */
export function fillHoles(cells: TileCell[], columnCount: number) {
  // Guard: any progress theory fails better with a dump than hanging the renderer.
  for (let iter = 0; ; iter++) {
    if (iter > 500) {
      console.error("[fillHoles] iter guard", JSON.stringify(cells));
      break;
    }
    const occ = occupancy(cells);
    const maxRow = Math.max(0, ...cells.map((c) => c.row + c.rowSpan));
    let grew = false;
    outer: for (let r = 0; r < maxRow; r++) {
      for (let k = 0; k < columnCount; k++) {
        if (occ.has(`${k},${r}`)) {
          continue;
        }
        const up = occ.get(`${k},${r - 1}`);
        if (up) {
          // rowSpan++ would cover the strip (up.col..+colSpan, r): all free or it does not grow
          let stripFree = true;
          for (let kk = up.col; kk < up.col + up.colSpan && stripFree; kk++) {
            if (occ.has(`${kk},${r}`)) {
              stripFree = false;
            }
          }
          if (stripFree) {
            up.rowSpan++;
            grew = true;
            break outer;
          }
        }
        const left = occ.get(`${k - 1},${r}`);
        if (left) {
          // colSpan++ would cover the strip (k, left.row..+rowSpan): all free or it does not grow
          let stripFree = true;
          for (let rr = left.row; rr < left.row + left.rowSpan && stripFree; rr++) {
            if (occ.has(`${k},${rr}`)) {
              stripFree = false;
            }
          }
          if (stripFree) {
            left.colSpan++;
            grew = true;
            break outer;
          }
        }
      }
    }
    if (!grew) {
      break;
    }
  }
}

/** Grows the cell by absorbing contiguous holes to its right and below (without stepping on others). */
export function absorbHoles(cells: TileCell[], c: TileCell, columnCount: number) {
  const occ = () => {
    const m = new Set<string>();
    for (const o of cells) {
      for (let r = o.row; r < o.row + o.rowSpan; r++) {
        for (let k = o.col; k < o.col + o.colSpan; k++) {
          m.add(`${k},${r}`);
        }
      }
    }
    return m;
  };
  for (let guard = 0; ; guard++) {
    if (guard > 500) {
      console.error("[absorbHoles] iter guard", JSON.stringify(cells));
      break;
    }
    const occupied = occ();
    const col = c.col + c.colSpan;
    let free = col < columnCount;
    for (let r = c.row; r < c.row + c.rowSpan && free; r++) {
      if (occupied.has(`${col},${r}`)) {
        free = false;
      }
    }
    if (!free) {
      break;
    }
    c.colSpan++;
  }
  const maxRow = Math.max(0, ...cells.map((o) => o.row + o.rowSpan));
  for (let guard = 0; ; guard++) {
    if (guard > 500) {
      console.error("[absorbHoles] iter guard", JSON.stringify(cells));
      break;
    }
    const occupied = occ();
    const row = c.row + c.rowSpan;
    let free = row < maxRow;
    for (let k = c.col; k < c.col + c.colSpan && free; k++) {
      if (occupied.has(`${k},${row}`)) {
        free = false;
      }
    }
    if (!free) {
      break;
    }
    c.rowSpan++;
  }
}
