// Rotating wireframe Cairngorm gem (loaders only — the one warm colour in the app).
// Yaw ≈ 6 s/turn; it enters with a fast spin-up turn (≈ .5 s/turn) that eases
// into that speed, so even a short load shows a visible 3D turn.
// System reduced-motion → rest pose (= the logo), unless motion is explicitly enabled.
import { useGemDisplay } from "@/appearance/hooks/use-gem-display";
import { useLayoutEffect, useRef } from "preact/hooks";
import { buildGem, GEM_REST } from "./gem-draw";
import { useGemAnimation } from "./use-gem-animation";

const SPIN_UP_SPEED = (Math.PI * 2) / 500; // rad/ms at mount
const SPIN_UP_MS = 1000; // quadratic ease-out back to `speed`

/** Extra yaw from the spin-up: ∫ (v0 − speed)(1 − e/D)² de, capped at e = D. */
function spinUp(elapsed: number, speed: number) {
  const u = Math.min(1, Math.max(0, elapsed / SPIN_UP_MS));
  return (((SPIN_UP_SPEED - speed) * SPIN_UP_MS) / 3) * (1 - (1 - u) ** 3);
}

interface Props {
  size: number;
  /** rad/ms — .00105 default, .0013 for the view loader */
  speed?: number;
  /** ms phase offset so several gems on one screen don't turn in sync */
  offset?: number;
  glow?: number;
}

export function CairngormGem({ size, speed = 0.00105, offset = 0, glow = 10 }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const draw = useRef<ReturnType<typeof buildGem> | null>(null);
  const elapsed = useRef(0);
  const { forceMotion } = useGemDisplay();
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) {
      return;
    }
    draw.current = buildGem(svg, 0);
    draw.current(GEM_REST.t, GEM_REST.yaw);
    return () => {
      draw.current = null;
      svg.innerHTML = "";
    };
  }, []);
  useGemAnimation(
    ref,
    true,
    (delta, reduced) => {
      elapsed.current += delta;
      const t = elapsed.current + GEM_REST.t + offset;
      if (reduced) {
        draw.current?.(GEM_REST.t, GEM_REST.yaw);
      } else {
        draw.current?.(t, t * speed + spinUp(elapsed.current, speed));
      }
    },
    forceMotion,
  );
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      class="cairngorm-gem block shrink-0"
      style={{ filter: `drop-shadow(0 0 ${glow}px rgba(217,196,168,.2))` }}
    />
  );
}
