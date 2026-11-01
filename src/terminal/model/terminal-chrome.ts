import type { TerminalState, TermTab } from "./types";

/** App/sidebar chrome needs tab metadata, not the document on every keystroke. */
export function sameTerminalChrome(prev: TerminalState, next: TerminalState): boolean {
  if (prev === next) {
    return true;
  }
  for (const key of Object.keys(next) as (keyof TerminalState)[]) {
    if (key !== "tabs" && prev[key] !== next[key]) {
      return false;
    }
  }
  if (prev.tabs.length !== next.tabs.length) {
    return false;
  }
  return next.tabs.every((tab, i) => {
    const old = prev.tabs[i];
    if (old === tab) {
      return true;
    }
    const keys = new Set([...Object.keys(old), ...Object.keys(tab)]);
    for (const key of keys as Set<keyof TermTab>) {
      if (key !== "content" && old[key] !== tab[key]) {
        return false;
      }
    }
    return true;
  });
}
