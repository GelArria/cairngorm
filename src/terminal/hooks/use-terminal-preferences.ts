import { useEffect, useState } from "preact/hooks";
import { getTerminalPreferences, subscribeTerminalPreferences } from "../data/terminal-preferences";

export function useTerminalPreferences() {
  const [p, set] = useState(getTerminalPreferences());
  useEffect(() => {
    set(getTerminalPreferences());
    return subscribeTerminalPreferences(set);
  }, []);
  return p;
}
