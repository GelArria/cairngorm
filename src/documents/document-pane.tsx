// The one generic surface for documents: every format and provider opens here. The pane
// owns the session and saving; the provider owns interpretation and its view.
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { useState } from "preact/hooks";
import { DocumentHeader } from "./components/document-header";
import { DocumentError, DocumentLoading, NoDocumentProvider } from "./components/document-states";
import { DocumentView } from "./components/document-view";
import { ProviderChooser } from "./components/provider-chooser";
import { useDocumentEditing } from "./hooks/use-document-editing";
import { useDocumentSession, type DocumentSessionOptions } from "./hooks/use-document-session";
import { useOpenDocument } from "./hooks/use-open-document";

export interface DocumentPaneProps extends DocumentSessionOptions {
  /** Project the pane belongs to: providers get separate storage per project. */
  scope: string;
  /** Addresses Ctrl+S and agent operations to this pane. */
  paneId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenWindow?: () => void;
}

export function DocumentPane(props: DocumentPaneProps) {
  const session = useDocumentSession(props);
  const { provider, snapshot } = session;
  const canEdit = Boolean(
    provider?.source === "installed" &&
    provider.capabilities.includes("edit") &&
    props.path &&
    !props.dataUrl,
  );
  const editing = useDocumentEditing({
    paneId: props.paneId,
    path: props.path,
    snapshot,
    canEdit,
    commit: session.commit,
    onDirtyChange: props.onDirtyChange,
  });
  useOpenDocument({
    paneId: props.paneId,
    scope: props.scope,
    path: props.path,
    provider,
    live: editing.live,
  });
  // Reloading or switching provider discards unsaved edits, so it is confirmed first.
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (action: () => void) => () => {
    if (editing.dirty) {
      setPending(() => action);
    } else {
      action();
    }
  };

  let body;
  if (session.status === "loading") {
    body = <DocumentLoading />;
  } else if (session.status === "none") {
    body = <NoDocumentProvider extension={props.extension} />;
  } else if (session.status === "choose") {
    body = (
      <ProviderChooser
        extension={props.extension}
        candidates={session.candidates}
        onChoose={session.choose}
      />
    );
  } else if (session.status === "error" || !provider || !snapshot) {
    body = (
      <DocumentError
        message={session.error ?? "The document could not be read."}
        onRetry={session.reload}
      />
    );
  } else {
    body = (
      <DocumentView
        provider={provider}
        snapshot={snapshot}
        title={props.title}
        scope={props.scope}
        canEdit={canEdit}
        onDirty={editing.setDirty}
        onLiveView={editing.attach}
        onRetry={session.reload}
      />
    );
  }

  return (
    <div data-testid="document-pane" class="flex h-full min-h-0 w-full flex-col bg-background">
      <DocumentHeader
        title={props.title}
        extension={props.extension}
        provider={provider}
        candidates={session.candidates}
        refreshing={session.refreshing}
        editable={canEdit}
        dirty={editing.dirty}
        saving={editing.saving}
        onSave={() => void editing.save()}
        onReload={props.path && provider ? guard(session.reload) : undefined}
        onOpenWith={(id) => guard(() => session.choose(id, false))()}
        // Unsaved edits live in this pane, so they are saved before the document can move.
        onOpenWindow={props.onOpenWindow && !editing.dirty ? props.onOpenWindow : undefined}
      />
      {editing.error && (
        <p
          role="alert"
          class="shrink-0 border-b border-border bg-destructive/5 px-3 py-2 font-sans text-xs text-destructive"
        >
          {editing.error}
        </p>
      )}
      {/* Grid panes inherit the terminal font; document states read as UI text. */}
      <div class="min-h-0 flex-1 font-sans">{body}</div>
      <ConfirmDialog
        open={editing.agentSave !== null}
        title="Save changes from an agent?"
        message={`An agent ran "${editing.agentSave?.operation ?? ""}" on ${props.title} and wants to save it. Saving writes every unsaved change in this document.`}
        confirmLabel="Save"
        onConfirm={() => editing.agentSave?.answer(true)}
        onCancel={() => editing.agentSave?.answer(false)}
      />
      <ConfirmDialog
        open={pending !== null}
        title="Discard unsaved changes?"
        message="Your edits to this document have not been saved."
        confirmLabel="Discard"
        onConfirm={() => {
          const action = pending;
          setPending(null);
          editing.setDirty(false);
          action?.();
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
