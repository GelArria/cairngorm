// Cairngorm (smoky-quartz) oval-cut gem: vertices, facets, outward normals and
// the edge/vertex → facet maps used for back-face culling. Built once, pure data.
// GEM (loader, logo > 48 px): girdle 16×(1,.76) · crown 16×(.82,.62)@.20 ·
//   table 8×(.54,.40)@.40 · pavilion 16×(.60,.45)@−.45 · culet line @−.82.
// GEM_MINI (icons ≤ 48 px): the same silhouette and table with every ring cut to
//   8 — crown trapezoids, pavilion straight to one culet — so it stays crisp small.
export type Vec3 = [number, number, number];

export interface GemMesh {
  VERTS: Vec3[];
  /** vertex indices of the table facet (always FACES[0]) */
  TABLE: number[];
  FACES: number[][];
  /** outward unit normal per facet */
  NORMALS: Vec3[];
  /** unique edges [a, b, owningFacets] */
  EDGES: [number, number, number[]][];
  /** edge/vertex opacity = lo + span × depth (the mini keeps every visible line strong) */
  FADE: [number, number];
  /** table facet fill */
  TABLE_FILL: string;
  /** facets owning each vertex */
  VERT_FACES: number[][];
}

const TAU = Math.PI * 2;

function ring(n: number, a: number, b: number, y: number, offset: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let q = 0; q < n; q++) {
    const t = ((q + offset) / n) * TAU;
    pts.push([a * Math.cos(t), y, b * Math.sin(t)]);
  }
  return pts;
}

export function buildMesh(
  VERTS: Vec3[],
  FACES: number[][],
  FADE: [number, number],
  TABLE_FILL: string,
): GemMesh {
  const NORMALS = FACES.map((f): Vec3 => {
    const [a, b, c] = [VERTS[f[0]], VERTS[f[1]], VERTS[f[2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const m = Math.hypot(...n) || 1;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const k of f) {
      cx += VERTS[k][0];
      cy += VERTS[k][1];
      cz += VERTS[k][2];
    }
    cx /= f.length;
    cy = cy / f.length + 0.05;
    cz /= f.length;
    n = [n[0] / m, n[1] / m, n[2] / m];
    return n[0] * cx + n[1] * cy + n[2] * cz < 0 ? [-n[0], -n[1], -n[2]] : n;
  });
  const map = new Map<string, number[]>();
  FACES.forEach((f, q) => {
    for (let m = 0; m < f.length; m++) {
      const a = f[m],
        b = f[(m + 1) % f.length];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      (map.get(k) ?? map.set(k, []).get(k)!).push(q);
    }
  });
  const EDGES = [...map.entries()].map(([k, qs]): [number, number, number[]] => {
    const [a, b] = k.split("-").map(Number);
    return [a, b, qs];
  });
  const VERT_FACES: number[][] = VERTS.map(() => []);
  FACES.forEach((f, q) => f.forEach((k) => VERT_FACES[k].push(q)));
  return { VERTS, TABLE: FACES[0], FACES, NORMALS, EDGES, VERT_FACES, FADE, TABLE_FILL };
}

/** 0–15 girdle · 16–31 crown · 32–39 table · 40–55 pavilion · 56/57 culet ends */
export const GEM: GemMesh = (() => {
  const verts: Vec3[] = [
    ...ring(16, 1, 0.76, 0, 0),
    ...ring(16, 0.82, 0.62, 0.2, 0.5),
    ...ring(8, 0.54, 0.4, 0.4, 0),
    ...ring(16, 0.6, 0.45, -0.45, 0.5),
    [0.26, -0.82, 0],
    [-0.26, -0.82, 0],
  ];
  const f: number[][] = [[32, 33, 34, 35, 36, 37, 38, 39]];
  for (let j = 0; j < 8; j++) {
    const jn = (j + 1) % 8;
    f.push([32 + j, 32 + jn, 16 + ((2 * j + 1) % 16), 16 + ((2 * j) % 16)]);
    f.push([32 + j, 16 + ((2 * j + 15) % 16), 16 + ((2 * j) % 16)]);
  }
  for (let j = 0; j < 16; j++) {
    const jn = (j + 1) % 16;
    f.push([16 + j, jn, j], [16 + j, 16 + jn, jn], [j, jn, 40 + j], [40 + j, jn, 40 + jn]);
    const kj = Math.cos(((j + 0.5) / 16) * TAU) >= 0 ? 56 : 57;
    const kn = Math.cos(((jn + 0.5) / 16) * TAU) >= 0 ? 56 : 57;
    f.push(kj === kn ? [40 + j, 40 + jn, kj] : [40 + j, 40 + jn, kn, kj]);
  }
  return buildMesh(verts, f, [0.12, 0.78], "rgba(217,196,168,.09)");
})();

/** 0–7 girdle · 8–15 table · 16 culet */
export const GEM_MINI: GemMesh = (() => {
  const verts: Vec3[] = [...ring(8, 1, 0.76, 0, 0), ...ring(8, 0.54, 0.4, 0.4, 0), [0, -0.82, 0]];
  const f: number[][] = [[8, 9, 10, 11, 12, 13, 14, 15]];
  for (let j = 0; j < 8; j++) {
    const jn = (j + 1) % 8;
    f.push([8 + j, 8 + jn, jn, j], [j, jn, 16]);
  }
  return buildMesh(verts, f, [0.7, 0.3], "rgba(217,196,168,.18)");
})();
