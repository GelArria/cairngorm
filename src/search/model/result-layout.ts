import type { SearchMatch } from "@/common/filesystem/fs-bridge";

export const FILE_ROW = 24;
// h-6
export const MATCH_ROW = 20;
// h-5
export const OVERSCAN = 240;
// px rendered above/below the viewport

type Row =
  | { kind: "file"; path: string; name: string; count: number; expanded: boolean }
  | { kind: "match"; m: SearchMatch };

/** Rows + their cumulative tops (tops[i] = y of row i, tops[n] = total height). */
export function layout(results: SearchMatch[], expandedFiles: Record<string, boolean>) {
  const groups = new Map<string, SearchMatch[]>();
  for (const r of results) {
    const g = groups.get(r.path);
    if (g) {
      g.push(r);
    } else {
      groups.set(r.path, [r]);
    }
  }
  const rows: Row[] = [];
  for (const [path, matches] of groups) {
    const expanded = expandedFiles[path] ?? true;
    rows.push({
      kind: "file",
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      count: matches.length,
      expanded,
    });
    if (expanded) {
      for (const m of matches) {
        rows.push({ kind: "match", m });
      }
    }
  }
  const tops = new Float64Array(rows.length + 1);
  for (let i = 0; i < rows.length; i++) {
    tops[i + 1] = tops[i] + (rows[i].kind === "file" ? FILE_ROW : MATCH_ROW);
  }
  return { rows, tops, fileCount: groups.size };
}

/** First row whose bottom edge is below `y`. */
export function rowAt(tops: Float64Array, y: number) {
  let lo = 0,
    hi = tops.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid + 1] <= y) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return Math.max(0, lo);
}

export type ResultLayout = ReturnType<typeof layout>;
