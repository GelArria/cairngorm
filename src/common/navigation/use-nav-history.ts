// Navigation history and mouse side buttons. Configurable keyboard triggers live in use-keybinds.
import {
  canNav,
  recordNav,
  stepNav,
  subscribeNav,
  type NavLocation,
} from "@/common/navigation/nav-history";
import { useEffect, useRef, useState } from "preact/hooks";

/** One user action (e.g. open a file → new pane + view switch) settles within this. */
const SETTLE_MS = 250;

interface Options {
  location: NavLocation;
  exists: (loc: NavLocation) => boolean;
  apply: (loc: NavLocation) => void;
}

export function useNavHistory({ location, exists, apply }: Options) {
  const [, rerender] = useState(0);
  useEffect(() => subscribeNav(() => rerender((n) => n + 1)), []);

  const { view, groupId, tabId } = location;
  useEffect(() => {
    const t = setTimeout(() => recordNav({ view, groupId, tabId }), SETTLE_MS);
    return () => clearTimeout(t);
  }, [view, groupId, tabId]);

  const go = (dir: -1 | 1) => {
    const loc = stepNav(dir, exists);
    if (loc) {
      apply(loc);
    }
  };

  // latest callback for the global listeners (subscribed once)
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    // mouse "back" (3) / "forward" (4) buttons; mousedown is swallowed so the
    // webview never tries a page navigation of its own
    const onDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) {
        return;
      }
      e.preventDefault();
      goRef.current(e.button === 3 ? -1 : 1);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, []);

  return {
    back: () => go(-1),
    forward: () => go(1),
    canGoBack: canNav(-1),
    canGoForward: canNav(1),
  };
}
