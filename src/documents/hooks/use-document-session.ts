// The document session owner for one pane: picks the provider, loads the authorized
// snapshot and publishes new versions. Late reads from an older request never land.
import { errorMessage } from "@/common/errors";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { readSnapshot } from "../data/document-snapshot";
import { rememberProviderChoice } from "../data/provider-preferences";
import type { DocumentSnapshot } from "../model/provider";
import { mimeTypeFor, providersFor, resolveProvider } from "../model/provider-match";
import { useDocumentProviders, useProviderChoice } from "./use-document-providers";

export interface DocumentSessionOptions {
  title: string;
  extension: string;
  path?: string;
  /** Content supplied by a drop or paste instead of a file on disk. */
  dataUrl?: string;
  /** Agent-opened snapshot; shown instead of reading `path` until the user reloads. */
  ticket?: string;
  /** Provider chosen for this pane ("Open with"). */
  providerId?: string;
  onProviderChange: (providerId: string) => void;
}

interface LoadState {
  key: string;
  snapshot?: DocumentSnapshot;
  error?: string;
  loading: boolean;
}

export function useDocumentSession(options: DocumentSessionOptions) {
  const { title, extension, path, dataUrl, ticket, providerId, onProviderChange } = options;
  const registry = useDocumentProviders();
  const remembered = useProviderChoice(extension);
  const candidates = useMemo(
    () => providersFor(registry.providers, extension),
    [registry.providers, extension],
  );
  const resolution = useMemo(
    () => resolveProvider(candidates, { explicit: providerId, remembered }),
    [candidates, providerId, remembered],
  );
  const provider = resolution.kind === "provider" ? resolution.provider : undefined;
  const [reloads, setReloads] = useState(0);
  // "Reload" means the file on disk now: the agent snapshot it replaced is no longer used.
  const [reloadedTicket, setReloadedTicket] = useState<string>();
  const shownTicket = ticket && ticket !== reloadedTicket ? ticket : undefined;
  const generation = useRef(0);
  const sourceKey = provider
    ? `${provider.id}\n${path ?? ""}\n${dataUrl ? dataUrl.length : ""}\n${shownTicket ?? ""}`
    : "";
  const [load, setLoad] = useState<LoadState>({ key: "", loading: false });

  useEffect(() => {
    if (!provider) {
      return;
    }
    const current = ++generation.current;
    setLoad((previous) =>
      previous.key === sourceKey
        ? { ...previous, loading: true }
        : { key: sourceKey, loading: true },
    );
    readSnapshot({
      name: title,
      extension,
      mimeType: mimeTypeFor(provider, extension),
      maxBytes: provider.maxBytes,
      path,
      dataUrl,
      ticket: shownTicket,
    })
      .then((snapshot) => {
        if (current !== generation.current) {
          return;
        }
        setLoad((previous) => ({
          key: sourceKey,
          loading: false,
          // An unchanged version keeps the same snapshot, so the view does not refresh.
          snapshot:
            previous.key === sourceKey && previous.snapshot?.version === snapshot.version
              ? previous.snapshot
              : snapshot,
        }));
      })
      .catch((error) => {
        if (current === generation.current) {
          setLoad({ key: sourceKey, loading: false, error: errorMessage(error) });
        }
      });
  }, [sourceKey, reloads]);

  // Closing the pane or switching provider invalidates any read still in flight.
  useEffect(() => () => void generation.current++, []);

  const current = load.key === sourceKey ? load : { key: sourceKey, loading: true };
  const status =
    !registry.loaded && resolution.kind === "none"
      ? "loading"
      : resolution.kind === "none"
        ? "none"
        : resolution.kind === "choose"
          ? "choose"
          : current.error
            ? "error"
            : current.snapshot
              ? "ready"
              : "loading";

  return {
    status,
    provider,
    candidates,
    snapshot: current.snapshot,
    error: current.error,
    refreshing: Boolean(current.snapshot && current.loading),
    /** A save Cairngorm committed becomes the current snapshot without rereading the file. */
    commit: (snapshot: DocumentSnapshot) => setLoad({ key: sourceKey, loading: false, snapshot }),
    reload: () => {
      setReloadedTicket(ticket);
      setReloads((n) => n + 1);
    },
    choose: (id: string, remember: boolean) => {
      if (remember) {
        rememberProviderChoice(extension, id);
      }
      onProviderChange(id);
    },
  } as const;
}
