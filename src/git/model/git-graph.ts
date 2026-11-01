// Client-side lane assignment for the history graph (git log --topo-order).
// Each row gets: the node's lane, lanes passing straight through, lanes that
// converge into the node from above (branch tips merging/forking off it) and
// lanes that leave the node downwards (extra parents of a merge).
export interface GraphCommit {
  hash: string;
  parents?: string[];
}

export interface GraphRow {
  lane: number;
  /** Lanes drawn top→bottom without touching the node. */
  through: number[];
  /** Node has a line coming from above / going below in its own lane. */
  up: boolean;
  down: boolean;
  /** Lanes (above) curving into the node. */
  merges: number[];
  /** Lanes (below) curving out of the node. */
  forks: number[];
}

export const LANE_COLORS = ["#a78bfa", "#3b82f6", "#10b981", "#f59e0b", "#f43f5e"];
export const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

export function layoutGraph(commits: GraphCommit[]): { rows: GraphRow[]; width: number } {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 1;
  const free = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  for (const c of commits) {
    let lane = lanes.indexOf(c.hash);
    const up = lane !== -1;
    if (lane === -1) {
      lane = free();
    }
    // Other lanes waiting for this same commit converge into it
    const merges: number[] = [];
    lanes.forEach((h, i) => {
      if (h === c.hash && i !== lane) {
        merges.push(i);
      }
    });
    const through = lanes
      .map((h, i) => (h && h !== c.hash && i !== lane ? i : -1))
      .filter((i) => i >= 0);
    for (const i of merges) {
      lanes[i] = null;
    }

    const parents = c.parents ?? [];
    lanes[lane] = parents[0] ?? null;
    const forks: number[] = [];
    for (const p of parents.slice(1)) {
      const existing = lanes.indexOf(p);
      if (existing !== -1) {
        forks.push(existing);
        continue;
      }
      const k = free();
      lanes[k] = p;
      forks.push(k);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    maxLanes = Math.max(maxLanes, lanes.length, lane + 1, ...merges.map((m) => m + 1));
    rows.push({ lane, through, up, down: !!parents[0], merges, forks });
  }
  return { rows, width: 30 + 16 * (maxLanes - 1) };
}
