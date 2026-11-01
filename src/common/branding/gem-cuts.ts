// Gem cuts for project gems. Same facet topology as the Cairngorm logo gem
// (girdle 16 · crown 16 · table 8 · pavilion 16 · culet line) — only the outline
// changes: each cut maps a ring angle to an (x, z) point on its silhouette.
// "oval" IS the brand gem (GEM / GEM_MINI), never rebuilt.
import { buildMesh, GEM, GEM_MINI, type GemMesh, type Vec3 } from "./gem-geometry";

type Shape = (t: number) => [number, number];

const sgn = (v: number) => (v < 0 ? -1 : 1);
const ellipse: Shape = (t) => [Math.cos(t), Math.sin(t)];
/** |x|^n + |z|^n = 1 — 4 = cushion, 6 = emerald step, 10 = princess square */
const superellipse =
  (n: number): Shape =>
  (t) => {
    const c = Math.cos(t),
      s = Math.sin(t);
    return [sgn(c) * Math.abs(c) ** (2 / n), sgn(s) * Math.abs(s) ** (2 / n)];
  };
/** Pointed at both ends (z ∝ sin² closes to a corner) */
const marquise: Shape = (t) => [Math.cos(t), sgn(Math.sin(t)) * Math.sin(t) ** 2];
/** Pointed at +x, round at −x */
const pear: Shape = (t) => [
  Math.cos(t),
  Math.cos(t) > 0 ? sgn(Math.sin(t)) * Math.sin(t) ** 2 : Math.sin(t),
];

/** Square with clipped corners: |x|, |z| ≤ 1 and |x| + |z| ≤ c (asscher, radiant). */
const clipped =
  (c: number): Shape =>
  (t) => {
    const x = Math.abs(Math.cos(t)),
      z = Math.abs(Math.sin(t));
    const r = Math.min(1 / x, 1 / z, c / (x + z));
    return [r * Math.cos(t), r * Math.sin(t)];
  };
/** Pointed at +x like a pear, squared off at −x. */
const shield: Shape = (t) => (Math.cos(t) > 0 ? marquise(t) : superellipse(8)(t));
/** Round at +x, flat at −x, re-centred so it spans −1..1. */
const halfMoon: Shape = (t) => [
  ((Math.max(Math.cos(t), -0.25) + 0.25) / 1.25) * 2 - 1,
  Math.sin(t),
];

export interface GemCut {
  id: string;
  name: string;
  /** girdle half-axes */
  a: number;
  b: number;
  shape: Shape;
  /** half length of the culet ridge at the bottom (0 = a point). Keep ≤ ~0.26:
   *  a longer ridge pokes out of the pavilion slope and the mesh stops being
   *  convex (back-face culling then shows lines that should be hidden). */
  culet: number;
}

export const GEM_CUTS: GemCut[] = [
  { id: "oval", name: "Oval", a: 1, b: 0.76, shape: ellipse, culet: 0.26 },
  { id: "round", name: "Round", a: 0.9, b: 0.9, shape: ellipse, culet: 0 },
  { id: "cushion", name: "Cushion", a: 0.92, b: 0.82, shape: superellipse(4), culet: 0.08 },
  { id: "princess", name: "Princess", a: 0.84, b: 0.84, shape: superellipse(10), culet: 0 },
  { id: "emerald", name: "Emerald", a: 1, b: 0.68, shape: superellipse(6), culet: 0.24 },
  { id: "marquise", name: "Marquise", a: 1.06, b: 0.56, shape: marquise, culet: 0.26 },
  { id: "pear", name: "Pear", a: 1, b: 0.72, shape: pear, culet: 0.2 },
  { id: "asscher", name: "Asscher", a: 0.86, b: 0.86, shape: clipped(1.6), culet: 0 },
  { id: "radiant", name: "Radiant", a: 1, b: 0.72, shape: clipped(1.6), culet: 0.2 },
  { id: "baguette", name: "Baguette", a: 1.1, b: 0.48, shape: superellipse(12), culet: 0.26 },
  { id: "shield", name: "Shield", a: 1, b: 0.8, shape: shield, culet: 0 },
  { id: "half-moon", name: "Half Moon", a: 0.9, b: 0.86, shape: halfMoon, culet: 0 },
];

export const DEFAULT_CUT = "oval";

export function findCut(id: string | undefined): GemCut {
  return GEM_CUTS.find((c) => c.id === id) ?? GEM_CUTS[0];
}

const TAU = Math.PI * 2;

function ring(cut: GemCut, n: number, k: number, y: number, offset: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let q = 0; q < n; q++) {
    const [x, z] = cut.shape(((q + offset) / n) * TAU);
    pts.push([cut.a * k * x, y, cut.b * k * z]);
  }
  return pts;
}

/** Full gem — the logo's topology, outline from the cut. */
function fullMesh(cut: GemCut): GemMesh {
  const verts: Vec3[] = [
    ...ring(cut, 16, 1, 0, 0),
    ...ring(cut, 16, 0.82, 0.2, 0.5),
    ...ring(cut, 8, 0.54, 0.4, 0),
    ...ring(cut, 16, 0.6, -0.45, 0.5),
    [cut.culet, -0.82, 0],
    [-cut.culet, -0.82, 0],
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
    const kj = verts[40 + j][0] >= 0 ? 56 : 57;
    const kn = verts[40 + jn][0] >= 0 ? 56 : 57;
    f.push(kj === kn ? [40 + j, 40 + jn, kj] : [40 + j, 40 + jn, kn, kj]);
  }
  return buildMesh(verts, f, GEM.FADE, GEM.TABLE_FILL);
}

/** Small sizes: 8 facets per ring, one culet (like GEM_MINI). */
function miniMesh(cut: GemCut): GemMesh {
  const verts: Vec3[] = [...ring(cut, 8, 1, 0, 0), ...ring(cut, 8, 0.54, 0.4, 0), [0, -0.82, 0]];
  const f: number[][] = [[8, 9, 10, 11, 12, 13, 14, 15]];
  for (let j = 0; j < 8; j++) {
    const jn = (j + 1) % 8;
    f.push([8 + j, 8 + jn, jn, j], [j, jn, 16]);
  }
  return buildMesh(verts, f, GEM_MINI.FADE, GEM_MINI.TABLE_FILL);
}

const cache = new Map<string, GemMesh>();

/** Mesh for a cut (built once). Oval returns the brand meshes themselves. */
export function cutMesh(id: string | undefined, mini: boolean): GemMesh {
  const cut = findCut(id);
  if (cut.id === "oval") {
    return mini ? GEM_MINI : GEM;
  }
  const key = `${cut.id}:${mini ? "mini" : "full"}`;
  let m = cache.get(key);
  if (!m) {
    m = mini ? miniMesh(cut) : fullMesh(cut);
    cache.set(key, m);
  }
  return m;
}
