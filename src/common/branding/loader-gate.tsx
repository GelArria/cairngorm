// When a loader is worth showing. Loads that finish within SHOW_AFTER never show
// one (no static flash of the gem); once shown it stays at least MIN_VISIBLE, so
// the spin-up turn of the gem actually reads as a 3D turn.
import { useEffect, useRef, useState } from "preact/hooks";

export const SHOW_AFTER = 150;
export const MIN_VISIBLE = 800;

export function useLoaderGate(
  loading: boolean,
  showAfter = SHOW_AFTER,
  minVisible = MIN_VISIBLE,
): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading) {
      if (shown) {
        return;
      }
      const id = setTimeout(() => {
        shownAt.current = performance.now();
        setShown(true);
      }, showAfter);
      return () => clearTimeout(id);
    }
    if (!shown) {
      return;
    }
    const id = setTimeout(
      () => setShown(false),
      Math.max(0, minVisible - (performance.now() - shownAt.current)),
    );
    return () => clearTimeout(id);
  }, [loading, shown]);
  return shown;
}
