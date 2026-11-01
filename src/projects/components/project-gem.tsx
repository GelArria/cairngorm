// A project's gem: the Cairngorm logo mesh (in the project's cut) in its stone
// colour, at the project's own resting angle. `spin` turns it slowly (like the
// splash loader); system reduced-motion keeps it still unless explicitly enabled.
// The frozen display pref
// (right-click the hero card) freezes every project gem where it stands.
import { useGemDisplay } from "@/appearance/hooks/use-gem-display";
import { buildGem, GEM_REST } from "@/common/branding//gem-draw";
import { useGemAnimation } from "@/common/branding//use-gem-animation";
import { useLayoutEffect, useRef } from "preact/hooks";
import { cutMesh } from "../../common/branding/gem-cuts";

interface Props {
  color: string;
  /** gem cut id (gem-cuts.ts); unset = oval, the brand cut */
  cut?: string;
  /** resting yaw (radians) — see gemYaw() */
  yaw: number;
  /** rendered width in px */
  size: number;
  spin?: boolean;
  /** redraw cap while spinning; unset = display rate */
  fps?: number;
  class?: string;
}

/** Same rule as the logo: ≤ 48 px uses the 8-facet mesh so it stays crisp */
const MINI_MAX = 48;
const SPEED = 0.00045; // rad per ms

export function ProjectGem({
  color,
  cut,
  yaw,
  size,
  spin = false,
  fps,
  class: className = "",
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const draw = useRef<((t: number, yaw?: number) => void) | null>(null);
  // Time spun so far: stopping keeps the gem where it is (no snap back to rest)
  const spun = useRef(0);
  const yawRef = useRef(yaw);
  yawRef.current = yaw;
  const mini = size <= MINI_MAX;
  const { frozen, forceMotion } = useGemDisplay();
  const frame = () =>
    draw.current?.(GEM_REST.t + spun.current, yawRef.current + spun.current * SPEED);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) {
      return;
    }
    draw.current = buildGem(svg, 0, cutMesh(cut, mini));
    frame();
    return () => {
      draw.current = null;
      svg.innerHTML = "";
    };
  }, [mini, cut]);

  useLayoutEffect(() => {
    frame();
  }, [yaw]);

  useGemAnimation(
    ref,
    spin && !frozen,
    (delta) => {
      spun.current += delta;
      frame();
    },
    forceMotion,
    fps,
  );

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="22 30 156 156"
      class={`cairngorm-gem project-gem ${mini ? "cairngorm-gem--no-dots" : ""} pointer-events-none block shrink-0 ${className}`}
      style={{ "--gem": color }}
    />
  );
}
