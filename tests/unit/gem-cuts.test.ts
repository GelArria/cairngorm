import { describe, it, expect } from "vitest";
import { GEM, GEM_MINI } from "@/common/branding//gem-geometry";
import { GEM_CUTS, cutMesh, findCut } from "@/common/branding/gem-cuts";

const extent = (vs: number[][], axis: 0 | 2) => Math.max(...vs.map((v) => Math.abs(v[axis])));

describe("gem cuts", () => {
  it("oval is the brand gem itself (logo meshes untouched)", () => {
    expect(cutMesh("oval", false)).toBe(GEM);
    expect(cutMesh("oval", true)).toBe(GEM_MINI);
    expect(cutMesh(undefined, false)).toBe(GEM);
    expect(findCut("nope").id).toBe("oval");
  });

  it("every cut builds the logo topology with finite geometry, cached", () => {
    for (const c of GEM_CUTS) {
      const full = cutMesh(c.id, false),
        mini = cutMesh(c.id, true);
      expect(full.VERTS).toHaveLength(GEM.VERTS.length);
      expect(full.FACES).toHaveLength(GEM.FACES.length);
      expect(mini.VERTS).toHaveLength(GEM_MINI.VERTS.length);
      expect(full.VERTS.flat().every(Number.isFinite)).toBe(true);
      expect(full.NORMALS.flat().every(Number.isFinite)).toBe(true);
      expect(cutMesh(c.id, false)).toBe(full);
    }
  });

  it("every full cut is convex (back-face culling stays correct)", () => {
    for (const c of GEM_CUTS) {
      const m = cutMesh(c.id, false);
      m.FACES.forEach((f, q) => {
        const n = m.NORMALS[q],
          o = m.VERTS[f[0]];
        for (const v of m.VERTS) {
          const d = n[0] * (v[0] - o[0]) + n[1] * (v[1] - o[1]) + n[2] * (v[2] - o[2]);
          expect(d, `${c.id}: a vertex pokes out of facet ${q}`).toBeLessThan(0.03);
        }
      });
    }
  });

  it("outlines differ: round/princess are as wide as deep, marquise is long and narrow", () => {
    const girdle = (id: string) => cutMesh(id, false).VERTS.slice(0, 16);
    for (const id of ["round", "princess"]) {
      expect(extent(girdle(id), 0)).toBeCloseTo(extent(girdle(id), 2), 1);
    }
    expect(extent(girdle("marquise"), 0) / extent(girdle("marquise"), 2)).toBeGreaterThan(1.7);
    // princess corners reach further out than a round of the same size
    const diag = (id: string) => Math.max(...girdle(id).map((v) => Math.hypot(v[0], v[2])));
    expect(diag("princess") / extent(girdle("princess"), 0)).toBeGreaterThan(
      diag("round") / extent(girdle("round"), 0),
    );
  });
});
