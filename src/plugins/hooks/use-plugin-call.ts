import type { PluginCallState } from "@/plugins/model/types";
import { useEffect, useState } from "preact/hooks";
import { getPluginCall, subscribePluginCalls } from "../data/plugin-store";

export function usePluginCall(id: string | undefined): PluginCallState | undefined {
  const [state, setState] = useState(() => getPluginCall(id));
  useEffect(() => {
    setState(getPluginCall(id));
    return subscribePluginCalls(() => setState(getPluginCall(id)));
  }, [id]);
  return state;
}
