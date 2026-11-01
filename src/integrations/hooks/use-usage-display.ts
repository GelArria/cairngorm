import { useEffect, useState } from "preact/hooks";

const KEY = "cairngorm.usage.showRemaining";

const EVENT = "cairngorm-usage-display";

function readShowRemaining(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowRemaining(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useShowRemaining(): boolean {
  const [value, setValue] = useState(readShowRemaining);
  useEffect(() => {
    const sync = () => setValue(readShowRemaining());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return value;
}
