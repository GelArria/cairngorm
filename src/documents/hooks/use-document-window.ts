// Lifecycle of a document window: agent operations main forwards to it, unsaved state main
// must know about, and returning the document to main when this window closes.
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  DOCUMENT_REATTACH,
  DOCUMENT_WINDOW_DIRTY,
  DOCUMENT_WINDOW_OPERATION,
  DOCUMENT_WINDOW_READY,
  type DocumentWindowPayload,
} from "../data/document-window";
import { answerAgentOperation, type OperationRequest } from "../data/open-documents";

export function useDocumentWindow(payload: DocumentWindowPayload) {
  const [providerId, setProviderId] = useState(payload.providerId);
  const [dirty, setDirtyState] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const latest = useRef({ dirty, providerId });
  latest.current = { dirty, providerId };
  const closing = useRef(false);

  const setDirty = (next: boolean) => {
    setDirtyState(next);
    // Main keeps the flag on the hidden tab, so closing Cairngorm asks about these edits.
    void emitTo("main", DOCUMENT_WINDOW_DIRTY, { tabId: payload.tabId, dirty: next }).catch(
      () => undefined,
    );
  };

  /** Hands the tab back to main and closes this window for good. */
  const returnToMain = async () => {
    closing.current = true;
    await emitTo("main", DOCUMENT_REATTACH, {
      tabId: payload.tabId,
      providerId: latest.current.providerId,
    }).catch(() => undefined);
    await getCurrentWebviewWindow().destroy();
  };

  useEffect(() => {
    const stops: Promise<() => void>[] = [];
    try {
      const self = getCurrentWebviewWindow();
      // Events addressed to this window only: another document window never answers here.
      stops.push(
        self.listen<OperationRequest & { id: string }>(
          DOCUMENT_WINDOW_OPERATION,
          ({ payload: request }) => {
            void answerAgentOperation(request, (outcome) =>
              invoke("document_request_complete", outcome),
            );
          },
        ),
      );
      stops.push(
        self.onCloseRequested((event) => {
          if (closing.current) {
            return;
          }
          event.preventDefault();
          if (latest.current.dirty) {
            setConfirmClose(true);
          } else {
            void returnToMain();
          }
        }),
      );
      void Promise.all(stops).then(() =>
        emitTo("main", DOCUMENT_WINDOW_READY, { tabId: payload.tabId, label: self.label }),
      );
    } catch (error) {
      // Outside a Tauri window (tests): nothing to forward or close.
      console.warn("[documents] document window events unavailable", error);
    }
    return () => {
      for (const stop of stops) {
        void stop.then((unlisten) => unlisten());
      }
    };
  }, []);

  return {
    providerId,
    setProviderId,
    setDirty,
    confirmClose,
    cancelClose: () => setConfirmClose(false),
    returnToMain,
    /** Moving back with unsaved changes asks first, like closing. */
    requestReturn: () => (latest.current.dirty ? setConfirmClose(true) : void returnToMain()),
  };
}
