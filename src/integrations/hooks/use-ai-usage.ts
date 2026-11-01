import { errorMessage } from "@/common/errors";
import { useEffect, useState } from "preact/hooks";
import { readAiUsage, type UsageReport } from "../data/ai-usage";

interface UsageSnapshot {
  reports: UsageReport[];
  checkedAt: Date;
}

// Survives panel close so reopening shows the last reading while it refreshes.
let lastSnapshot: UsageSnapshot | null = null;
// One backend read at a time: each read spawns several CLI processes, and quick
// reopenings must not stack them or let an older reading overwrite a newer one.
let inflight: Promise<UsageSnapshot> | null = null;

function loadUsage(): Promise<UsageSnapshot> {
  inflight ??= readAiUsage()
    .then((reports) => (lastSnapshot = { reports, checkedAt: new Date() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Reads quota whenever the panel mounts; `refresh` re-reads on demand. */
export function useAiUsage() {
  const [snapshot, setSnapshot] = useState(lastSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadUsage()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  return { snapshot, loading, error, refresh: () => setRequest((n) => n + 1) };
}
