import { useEffect, useState } from "preact/hooks";
import { hasPermissionsOff, subscribeLaunchPermissions } from "../data/launch-permissions";

/** Whether this terminal's agent was launched with its permission checks off. */
export function usePermissionsOff(sessionId: string | undefined): boolean {
  const [off, setOff] = useState(() => hasPermissionsOff(sessionId));
  useEffect(() => {
    setOff(hasPermissionsOff(sessionId));
    return subscribeLaunchPermissions(() => setOff(hasPermissionsOff(sessionId)));
  }, [sessionId]);
  return off;
}
