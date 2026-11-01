// A document in its own window: the same generic pane as in the grid, plus a way back.
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Icon } from "@/common/ui/icon";
import type { DocumentWindowPayload } from "./data/document-window";
import { DocumentPane } from "./document-pane";
import { useDocumentWindow } from "./hooks/use-document-window";

export function DocumentWindowView({ payload }: { payload: DocumentWindowPayload }) {
  const window = useDocumentWindow(payload);
  return (
    <div class="flex h-screen w-screen flex-col bg-background text-foreground">
      <div class="flex shrink-0 items-center justify-end border-b border-border px-2 py-1">
        <Button
          variant="subtle"
          size="xs"
          onClick={window.requestReturn}
          data-testid="document-window-return"
        >
          <Icon name="arrow-u-up-right" class="mr-1" />
          Move back to main window
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <DocumentPane
          title={payload.title}
          extension={payload.extension}
          path={payload.path}
          ticket={payload.ticket}
          providerId={window.providerId}
          scope={payload.scope}
          paneId={`window-${payload.tabId}`}
          onProviderChange={window.setProviderId}
          onDirtyChange={window.setDirty}
        />
      </div>
      <ConfirmDialog
        open={window.confirmClose}
        title="Discard unsaved changes?"
        message="Your edits to this document have not been saved. The document goes back to the main window without them."
        confirmLabel="Discard"
        onConfirm={() => void window.returnToMain()}
        onCancel={window.cancelClose}
      />
    </div>
  );
}
