import { useAppReducedMotion } from "@/appearance/hooks/use-gem-display";
import "@fontsource/instrument-sans/600.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { buildGem, GEM_REST } from "../../common/branding/gem-draw";
import { LETTER_STAGGER, SETTLED_AT, SPLASH, splashPose } from "../model/splash-timeline";

const NAME = "Cairngorm";
const ms = (n: number) => `${n}ms`;

// Global splash = the logo intro: the 280px loader gem spins, settles into the
// logo pose and the name rises under it. Any key or click skips it;
// prefers-reduced-motion shows the final frame and fades.
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const gemRef = useRef<SVGSVGElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [leaving, setLeaving] = useState(false);
  const reduced = useAppReducedMotion();

  useEffect(() => {
    const svg = gemRef.current;
    if (!svg) {
      return;
    }
    const draw = buildGem(svg, 0);
    if (reduced) {
      draw(GEM_REST.t, GEM_REST.yaw);
      return () => {
        svg.innerHTML = "";
      };
    }
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = now - start,
        p = splashPose(t);
      draw(p.t, p.yaw);
      if (t < SETTLED_AT) {
        raf = requestAnimationFrame(frame);
      }
    };
    const p0 = splashPose(0);
    draw(p0.t, p0.yaw);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      svg.innerHTML = "";
    };
  }, [reduced]);

  useEffect(() => {
    const id = setTimeout(() => setLeaving(true), reduced ? SPLASH.reducedLeave : SPLASH.leave);
    const skip = () => setLeaving(true);
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", skip);
    };
  }, [reduced]);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const id = setTimeout(() => doneRef.current(), SPLASH.fade);
    return () => clearTimeout(id);
  }, [leaving]);

  return (
    <div
      data-testid="splash"
      onPointerDown={() => setLeaving(true)}
      class={`fixed inset-0 z-[9999] flex select-none items-center justify-center bg-background transition-opacity duration-500 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div class="flex flex-col items-center">
        <svg
          ref={gemRef}
          width={280}
          height={280}
          viewBox="0 0 200 200"
          aria-hidden="true"
          class="cairngorm-gem splash-gem block"
          style={{ animationDelay: ms(SETTLED_AT - 200) }}
        />
        {/* The rest-pose gem ends ~67px above the box bottom: pull the name up under it */}
        <div class="-mt-10 flex flex-col items-center">
          <h1
            aria-label={NAME}
            class="whitespace-nowrap font-brand text-[56px] font-semibold leading-none tracking-[-0.03em] text-foreground"
          >
            {[...NAME].map((c, i) => (
              <span
                key={i}
                aria-hidden="true"
                class="splash-letter inline-block"
                style={{ animationDelay: ms(SPLASH.name + i * LETTER_STAGGER) }}
              >
                {c}
              </span>
            ))}
          </h1>
        </div>
      </div>

      <style>{`
        @keyframes splash-rise { from { opacity: 0; transform: translateY(16px); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
        @keyframes splash-glow { 50% { filter: drop-shadow(0 0 26px rgba(217,196,168,.32)); } }
        .splash-letter { animation: splash-rise 650ms cubic-bezier(.22,1,.36,1) both; }
        .splash-gem { filter: drop-shadow(0 0 16px rgba(217,196,168,.2)); animation: splash-glow 900ms ease-in-out; }
        @media (prefers-reduced-motion: reduce) {
          html:not([data-force-motion]) :is(.splash-letter, .splash-gem) { animation: none; }
        }
      `}</style>
    </div>
  );
}
