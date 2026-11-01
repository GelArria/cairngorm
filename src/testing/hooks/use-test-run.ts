import { useEffect, useState } from "preact/hooks";
import { getTestRun, subscribeTestRun } from "../data/test-store";

export function useTestRun(sessionId: string) {
  const [run, setRun] = useState(() => getTestRun(sessionId));
  useEffect(() => {
    const update = () => setRun(getTestRun(sessionId));
    const unsubscribe = subscribeTestRun(sessionId, update);
    update();
    return unsubscribe;
  }, [sessionId]);
  return run;
}
