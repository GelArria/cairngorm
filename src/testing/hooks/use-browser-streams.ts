import { useEffect, useState } from "preact/hooks";
import { getBrowserStreams, subscribeBrowserStreams } from "../data/browser-store";

export function useBrowserStreams(id: string) {
  const [value, setValue] = useState(() => getBrowserStreams(id));
  useEffect(() => {
    const update = () => setValue(getBrowserStreams(id));
    const unsubscribe = subscribeBrowserStreams(id, update);
    update();
    return unsubscribe;
  }, [id]);
  return value;
}
