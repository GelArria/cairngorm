import { useState } from "preact/hooks";
import { BUILTIN_VIEWS } from "../builtin/views";
import type { DocumentProviderInfo, DocumentSnapshot, DocumentViewProps } from "../model/provider";
import { DocumentError, DocumentLoading } from "./document-states";
import { IsolatedDocumentView } from "./isolated-document-view";

/** The provider's view plus the pane's loading and failure overlays. */
export function DocumentView({
  provider,
  snapshot,
  title,
  scope,
  canEdit,
  onDirty,
  onLiveView,
  onRetry,
}: {
  provider: DocumentProviderInfo;
  snapshot: DocumentSnapshot;
  title: string;
  scope: string;
  canEdit: boolean;
  onDirty: (dirty: boolean) => void;
  onLiveView: DocumentViewProps["onLiveView"];
  onRetry: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const viewKey = `${provider.id}@${provider.version}#${attempt}`;
  const [view, setView] = useState({ key: "", ready: false, error: "" });
  const current = view.key === viewKey ? view : { key: viewKey, ready: false, error: "" };
  const report = (patch: { ready?: boolean; error?: string }) =>
    setView((previous) => ({ ...(previous.key === viewKey ? previous : current), ...patch }));
  const retry = () => {
    setAttempt((n) => n + 1);
    onRetry();
  };
  const viewProps = {
    snapshot,
    title,
    canEdit,
    onDirty,
    onLiveView,
    onReady: () => report({ ready: true, error: "" }),
    onError: (error: string) => report({ error }),
  };
  const Builtin = provider.source === "builtin" ? BUILTIN_VIEWS[provider.id] : undefined;
  return (
    <div class="relative h-full min-h-0">
      {Builtin ? (
        // A new version remounts in-process views; isolated views refresh themselves.
        <Builtin key={`${viewKey}:${snapshot.version}`} {...viewProps} />
      ) : (
        <IsolatedDocumentView
          key={viewKey}
          providerId={provider.id}
          providerName={provider.name}
          scope={scope}
          {...viewProps}
        />
      )}
      {current.error ? (
        <div class="absolute inset-0 bg-background">
          <DocumentError message={current.error} onRetry={retry} />
        </div>
      ) : (
        !current.ready && (
          <div class="pointer-events-none absolute inset-0 bg-background">
            <DocumentLoading label={`Opening with ${provider.name}…`} />
          </div>
        )
      )}
    </div>
  );
}
