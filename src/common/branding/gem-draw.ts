// Cairngorm gem renderer shared by the loader, the static logo and the splash.
// Orthographic + light perspective, back-face culled: an edge/vertex is drawn only
// when one of its facets faces the viewer. Pitch .8 ± .06 (slow bob), roll .2.
import { GEM, type GemMesh } from "./gem-geometry";

export { GEM, GEM_MINI } from "./gem-geometry";

const NS = "http://www.w3.org/2000/svg";
const S = 68,
  CX = 100,
  CY = 104,
  ROLL = 0.2;
const fade = (z: number, lo: number, span: number) =>
  (lo + span * Math.min(1, Math.max(0, (z + 1.1) / 2.2))).toFixed(2);

/** The logo pose: the loader's rest frame (also its prefers-reduced-motion frame). */
export const GEM_REST = { t: 600, yaw: 0.6 } as const;
/** viewBox cropped to the gem in its rest pose (logo, icons). The loader keeps 0 0 200 200. */
export const MARK_VIEWBOX = "34 52 132 108";

/** Appends the gem's elements to `svg`; returns draw(t ms, yaw?) — yaw defaults to t × speed.
 *  `mesh` = GEM_MINI for icons ≤ 48 px (same pose, fewer facets). */
export function buildGem(svg: SVGSVGElement, speed: number, mesh: GemMesh = GEM) {
  const {
    VERTS,
    TABLE,
    NORMALS,
    EDGES,
    VERT_FACES,
    FADE: [lo, span],
    TABLE_FILL,
  } = mesh;
  const lines = EDGES.map(() => svg.appendChild(document.createElementNS(NS, "line")));
  const poly = svg.appendChild(document.createElementNS(NS, "polygon"));
  poly.setAttribute("fill", TABLE_FILL);
  const dots = VERTS.map(() => {
    const c = svg.appendChild(document.createElementNS(NS, "circle"));
    c.setAttribute("r", "1.5");
    return c;
  });
  const cr = Math.cos(ROLL),
    sr = Math.sin(ROLL);

  return (t: number, yawOverride?: number) => {
    const yaw = yawOverride ?? t * speed;
    const cyw = Math.cos(yaw),
      syw = Math.sin(yaw);
    const ph = 0.8 + Math.sin(t * 0.0007) * 0.06,
      cp = Math.cos(ph),
      sp = Math.sin(ph);
    const front = NORMALS.map((n) => n[1] * sp + (-n[0] * syw + n[2] * cyw) * cp > 0.02);
    const P = VERTS.map((v, i) => {
      const x1 = v[0] * cyw + v[2] * syw,
        z1 = -v[0] * syw + v[2] * cyw;
      const y2 = v[1] * cp - z1 * sp,
        z2 = v[1] * sp + z1 * cp;
      const x3 = x1 * cr - y2 * sr,
        y3 = x1 * sr + y2 * cr,
        f = 1 / (1 - z2 * 0.1);
      const p: [number, number, number] = [CX + x3 * S * f, CY - y3 * S * f, z2];
      const d = dots[i];
      d.setAttribute("cx", p[0].toFixed(2));
      d.setAttribute("cy", p[1].toFixed(2));
      d.setAttribute("opacity", VERT_FACES[i].some((q) => front[q]) ? fade(z2, 0.15, 0.7) : "0");
      return p;
    });
    poly.setAttribute(
      "points",
      front[0] ? TABLE.map((i) => `${P[i][0].toFixed(1)},${P[i][1].toFixed(1)}`).join(" ") : "",
    );
    EDGES.forEach(([a, b, qs], k) => {
      const l = lines[k],
        pa = P[a],
        pb = P[b];
      l.setAttribute("x1", pa[0].toFixed(2));
      l.setAttribute("y1", pa[1].toFixed(2));
      l.setAttribute("x2", pb[0].toFixed(2));
      l.setAttribute("y2", pb[1].toFixed(2));
      l.setAttribute(
        "opacity",
        qs.some((q) => front[q]) ? fade((pa[2] + pb[2]) / 2, lo, span) : "0",
      );
    });
  };
}
