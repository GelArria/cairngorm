import { useEffect, useState } from "preact/hooks";
import { getBrowserActivities, subscribeBrowserActivities } from "../data/browser-activity";

export function useBrowserActivities(id: string) {
  const [value, setValue] = useState(() => getBrowserActivities(id));
  useEffect(() => {
    const update = () => setValue(getBrowserActivities(id));
    const unsubscribe = subscribeBrowserActivities(id, update);
    update();
    return unsubscribe;
  }, [id]);
  return value;
}
