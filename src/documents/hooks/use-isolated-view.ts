// Mounts one installed provider's page in its own origin and keeps it in sync with the
// session: new snapshot versions, theme and size changes, and teardown on close.
import { subscribeAppearance } from "@/appearance/data/store";
import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "preact/hooks";
import { DocumentViewHost } from "../data/document-view-host";
import { hostContext, hostTheme } from "../data/host-context";
import type { DocumentViewProps } from "../model/provider";

export function useIsolatedView({
  providerId,
  scope,
  snapshot,
  onReady,
  onError,
  canEdit = false,
  onDirty,
  onLiveView,
}: Omit<DocumentViewProps, "title"> & { providerId: string; scope: string }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<DocumentViewHost | null>(null);
  const latest = useRef({ snapshot, onReady, onError, onDirty, onLiveView });
  latest.current = { snapshot, onReady, onError, onDirty, onLiveView };
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;
    let view: DocumentViewHost | null = null;
    let stopTheme = () => {};
    let timer = 0;
    const resize = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () =>
          view?.contextChanged({
            containerDimensions: hostContext(container.current).containerDimensions,
          }),
        150,
      );
    });
    invoke<string>("document_view_url", { provider: providerId, scope })
      .then((url) => {
        if (!alive || !frame.current) {
          return;
        }
        view = new DocumentViewHost({
          frame: frame.current,
          origin: new URL(url).origin,
          snapshot: () => latest.current.snapshot,
          context: () => hostContext(container.current),
          onReady: () => latest.current.onReady(),
          onError: (message) => latest.current.onError(message),
          canEdit,
          onDirty: (dirty) => latest.current.onDirty?.(dirty),
        });
        host.current = view;
        latest.current.onLiveView?.(view);
        // Load only once the host listens, so the first message is never missed.
        frame.current.src = url;
        resize.observe(container.current!);
        stopTheme = subscribeAppearance(() => view?.contextChanged(hostTheme()));
      })
      .catch((error) => {
        if (alive) {
          setLoadError(errorMessage(error));
        }
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      resize.disconnect();
      stopTheme();
      view?.dispose();
      host.current = null;
      latest.current.onLiveView?.(null);
    };
  }, [providerId, scope, canEdit]);

  useEffect(() => {
    host.current?.documentChanged();
  }, [snapshot.version]);

  return { container, frame, loadError };
}
