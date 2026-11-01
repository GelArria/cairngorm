import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

/** One cancellable SVG loop; no GPU/context requirement. Every frame rewrites the mesh
 * (layout, paint and GPU raster), so the loop runs only while the gem is on screen, the
 * document is visible. `maxFps` caps the redraw rate. Resumes on
 * window restore and live OS motion changes, without counting paused time as rotation. */
export function useGemAnimation(
  target: RefObject<SVGSVGElement>,
  enabled: boolean,
  frame: (delta: number, reduced: boolean) => void,
  forceMotion = false,
  maxFps?: number,
) {
  const draw = useRef(frame);
  draw.current = frame;

  useLayoutEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const interval = maxFps ? 1000 / maxFps : 0;
    // Throttled frames are long by design; the cap only absorbs stalls.
    const maxDelta = Math.max(50, interval * 2);
    let raf = 0;
    let last = performance.now();
    // Keep-alive panels hide without a visibility event; an observer avoids a forced
    // layout read on every frame. Assume visible until the first report.
    let onScreen = true;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const tick = (now: number) => {
      raf = 0;
      if (document.hidden || !onScreen || (!forceMotion && media?.matches)) {
        return;
      }
      if (now - last >= interval) {
        const delta = Math.max(0, Math.min(now - last, maxDelta));
        // Keep the remainder so a 20 fps cap on a 60 Hz display does not drift to 15.
        last = interval ? now - ((now - last) % interval) : now;
        draw.current(delta, false);
      }
      raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      stop();
      last = performance.now();
      const reduced = !forceMotion && !!media?.matches;
      draw.current(0, reduced);
      if (enabled && onScreen && !document.hidden && !reduced) {
        raf = requestAnimationFrame(tick);
      }
    };
    // Callers must render the <svg ref> unconditionally; without it there is no observer.
    const observer =
      typeof IntersectionObserver === "function" && target.current
        ? new IntersectionObserver((entries) => {
            const visible = entries.some((e) => e.isIntersecting);
            if (visible !== onScreen) {
              onScreen = visible;
              resume();
            }
          })
        : null;
    if (observer && target.current) {
      observer.observe(target.current);
    }
    // Older WebViews expose only MediaQueryList.addListener.
    if (media?.addEventListener) {
      media.addEventListener("change", resume);
    } else {
      media?.addListener?.(resume);
    }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    resume();
    return () => {
      stop();
      observer?.disconnect();
      if (media?.removeEventListener) {
        media.removeEventListener("change", resume);
      } else {
        media?.removeListener?.(resume);
      }
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [enabled, forceMotion, maxFps]);
}
