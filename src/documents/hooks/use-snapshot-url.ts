import { useEffect, useState } from "preact/hooks";
import type { DocumentSnapshot } from "../model/provider";

/** A data URL for viewers that load from a URL; recreated only for a new version. */
export function useSnapshotDataUrl(snapshot: DocumentSnapshot) {
  const [url, setUrl] = useState<{ version: string; value: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (alive) {
        setUrl({ version: snapshot.version, value: String(reader.result) });
      }
    };
    reader.readAsDataURL(new Blob([snapshot.bytes.slice()], { type: snapshot.mimeType }));
    return () => {
      alive = false;
      reader.abort();
    };
  }, [snapshot.version]);
  return url?.version === snapshot.version ? url.value : "";
}
