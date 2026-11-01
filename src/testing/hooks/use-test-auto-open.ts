import { useEffect, useState } from "preact/hooks";
import { isTestAutoOpenEnabled, subscribeTestAutoOpen } from "../data/test-auto-open";

export function useTestAutoOpen(): boolean {
  const [value, setValue] = useState(isTestAutoOpenEnabled());
  useEffect(() => {
    const unsubscribe = subscribeTestAutoOpen(setValue);
    setValue(isTestAutoOpenEnabled());
    return unsubscribe;
  }, []);
  return value;
}
