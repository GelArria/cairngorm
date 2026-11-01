// Detected shells with cairngorm.json applied; follows changes to the file.
import { subscribeConfig } from "@/config";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "preact/hooks";
import { setDetectedShells, withConfiguredShells } from "../data/configured-shells";
import type { DetectedShell } from "../model/types";

export function useConfiguredShells(): DetectedShell[] {
  const [detected, setDetected] = useState<DetectedShell[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeConfig(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    invoke<DetectedShell[]>("detect_shells")
      .then((shells) => {
        const list = Array.isArray(shells) ? shells : [];
        setDetectedShells(list);
        if (live) setDetected(list);
      })
      .catch(() => live && setDetected([]));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => withConfiguredShells(detected), [detected, version]);
}
