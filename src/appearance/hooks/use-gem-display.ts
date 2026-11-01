import { useEffect, useState } from "preact/hooks";
import {
  getGemDisplay,
  isAppMotionReduced,
  subscribeGemDisplay,
  type GemDisplay,
} from "../data/motion-preferences";

/** `frozen` includes the OS preference so rotation menus reflect the real state. */
export function useGemDisplay(): GemDisplay {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    const unsubscribe = subscribeGemDisplay(l);
    l(); // catch preference changes between render and subscription
    return unsubscribe;
  }, []);
  return { ...getGemDisplay(), frozen: getGemDisplay().frozen || isAppMotionReduced() };
}

/** Unlike project freeze, reduced motion also governs loaders and the splash. */
export function useAppReducedMotion(): boolean {
  useGemDisplay();
  return isAppMotionReduced();
}
