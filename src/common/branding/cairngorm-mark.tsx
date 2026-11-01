// The Cairngorm logo: the loader gem frozen in its rest pose, cropped to the gem.
// Same mesh and stroke as the loader — only the framing differs. At ≤ 48 px it
// switches to GEM_MINI (same pose, 8 facets per ring) so it doesn't blur into a blob.
import { useEffect, useRef } from "preact/hooks";
import { buildGem, GEM, GEM_MINI, GEM_REST, MARK_VIEWBOX } from "./gem-draw";

/** widest mark that still uses the minimal gem */
export const MINI_MAX = 48;

interface Props {
  /** rendered width in px (height follows the 132:108 crop) */
  size: number;
  /** drop-shadow radius in px (0 = none) — the splash uses 16 */
  glow?: number;
  /** vertex dots (never drawn on the minimal gem) */
  dots?: boolean;
  /** paper = the #f2eee8 ground: darker edges/vertices, same mesh */
  tone?: "obsidian" | "paper";
  /** hide from assistive tech when a parent already names the logo */
  decorative?: boolean;
  class?: string;
}

export function CairngormMark({
  size,
  glow = 0,
  dots = true,
  tone = "obsidian",
  decorative = false,
  class: className = "",
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const mini = size <= MINI_MAX;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) {
      return;
    }
    buildGem(svg, 0, mini ? GEM_MINI : GEM)(GEM_REST.t, GEM_REST.yaw);
    return () => {
      svg.innerHTML = "";
    };
  }, [mini]);
  return (
    <svg
      ref={ref}
      width={size}
      height={Math.round((size * 108) / 132)}
      viewBox={MARK_VIEWBOX}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Cairngorm"}
      aria-hidden={decorative || undefined}
      class={`cairngorm-gem block shrink-0 ${dots && !mini ? "" : "cairngorm-gem--no-dots"} ${tone === "paper" ? "cairngorm-gem--paper" : ""} ${className}`}
      style={glow ? { filter: `drop-shadow(0 0 ${glow}px rgba(217,196,168,.2))` } : undefined}
    />
  );
}
