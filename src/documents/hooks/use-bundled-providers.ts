import { errorMessage } from "@/common/errors";
import { useEffect, useState } from "preact/hooks";
import {
  installBundledProvider,
  listBundledProviders,
  type BundledProvider,
} from "../data/bundled-providers";
import { subscribeProviderRegistry } from "../data/provider-registry";

/** Providers shipped with Cairngorm and whether each is installed; refreshed on changes. */
export function useBundledProviders() {
  const [bundled, setBundled] = useState<BundledProvider[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listBundledProviders()
        .then((list) => alive && setBundled(list))
        .catch(() => alive && setBundled([]));
    void refresh();
    const stop = subscribeProviderRegistry(() => void refresh());
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const add = async (name: string) => {
    setAdding(name);
    setError("");
    try {
      await installBundledProvider(name);
      setBundled(await listBundledProviders());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setAdding(null);
    }
  };

  return { bundled, adding, error, add };
}
