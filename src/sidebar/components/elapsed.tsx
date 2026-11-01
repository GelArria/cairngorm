// Leaf label for a terminal's time in its current state — the only thing the
// 1 s ticker re-renders.
import { useEffect, useState } from "preact/hooks";
import { formatElapsed, markOf, subscribeTick } from "../hooks/use-terminal-elapsed";

export function Elapsed({ tabId, class: className = "" }: { tabId: string; class?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => subscribeTick(() => setNow(Date.now())), []);
  const at = markOf(tabId);
  if (at === undefined) {
    return null;
  }
  return <span class={className}>{formatElapsed(now - at)}</span>;
}
