import { useEffect, useRef } from "preact/hooks";
import { registerOpenDocument, type OpenDocument } from "../data/open-documents";
import type { DocumentProviderInfo } from "../model/provider";

/** Makes this pane reachable by agent operations in its own project while it shows a provider. */
export function useOpenDocument({
  paneId,
  scope,
  path,
  provider,
  live,
}: {
  paneId?: string;
  scope: string;
  path?: string;
  provider?: DocumentProviderInfo;
  live: Pick<OpenDocument, "view" | "dirty" | "canSave" | "save" | "confirmSave">;
}) {
  const latest = useRef(live);
  latest.current = live;
  useEffect(() => {
    if (!paneId || !provider) {
      return;
    }
    return registerOpenDocument({
      paneId,
      scope,
      path,
      provider,
      view: () => latest.current.view(),
      dirty: () => latest.current.dirty(),
      canSave: () => latest.current.canSave(),
      save: () => latest.current.save(),
      confirmSave: (operation, deadline) => latest.current.confirmSave(operation, deadline),
    });
  }, [paneId, scope, path, provider]);
}
