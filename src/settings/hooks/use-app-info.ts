// Read-only facts for Settings; native-agent setup is owned by AgentSettings.
import { useEffect, useState } from "preact/hooks";
import type { DetectedShell } from "../../terminal/types";

export function useAppInfo(open: boolean) {
  const [version, setVersion] = useState<string | null>(null);
  const [shells, setShells] = useState<DetectedShell[] | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let alive = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => alive && setVersion(v))
      .catch(() => {});
    import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        const sh = await invoke<DetectedShell[]>("detect_shells").catch(() => []);
        if (alive) {
          setShells(sh);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  return { version, shells };
}
