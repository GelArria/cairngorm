import { errorMessage } from "@/common/errors";
import { useEffect, useState } from "preact/hooks";
import { getClis, scanClis, subscribeClis } from "../data/cli-launch";

export function useCliCatalog() {
  const [clis, setClis] = useState(getClis());
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const scan = (force = false) => {
    setScanning(true);
    setError("");
    return scanClis(force)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setScanning(false));
  };
  useEffect(() => {
    const off = subscribeClis(() => setClis(getClis()));
    setClis(getClis());
    void scan();
    return off;
  }, []);
  return { clis, error, scanning, rescan: () => scan(true) };
}
