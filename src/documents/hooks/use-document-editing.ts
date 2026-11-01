// Unsaved-state and saving for one document pane whose provider can edit.
import { errorMessage } from "@/common/errors";
import { useEffect, useRef, useState } from "preact/hooks";
import { DOCUMENT_SAVE_REQUEST, saveDocument } from "../data/document-save";
import type { DocumentSnapshot, LiveDocumentView } from "../model/provider";

/** An agent asking to save after an operation; the user answers in the pane. */
export interface AgentSaveRequest {
  operation: string;
  answer: (approved: boolean) => void;
}

export function useDocumentEditing({
  paneId,
  path,
  snapshot,
  canEdit,
  commit,
  onDirtyChange,
}: {
  paneId?: string;
  path?: string;
  snapshot?: DocumentSnapshot;
  canEdit: boolean;
  /** Publishes the committed bytes as the session's current snapshot. */
  commit: (snapshot: DocumentSnapshot) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const view = useRef<LiveDocumentView | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [agentSave, setAgentSave] = useState<AgentSaveRequest | null>(null);
  const latest = useRef({ path, snapshot, canEdit });
  latest.current = { path, snapshot, canEdit };
  // Refs, not render state: two saves in the same tick must not both start.
  const savingNow = useRef(false);
  const dirtyNow = useRef(false);
  /** Increments with every reported edit, so edits made during a save stay unsaved. */
  const edits = useRef(0);

  const setDirty = (next: boolean) => {
    if (next) {
      edits.current++;
    }
    dirtyNow.current = next;
    setDirtyState(next);
    onDirtyChange?.(next);
  };

  /** Resolves `true` once the provider's bytes are on disk. */
  const save = async (): Promise<boolean> => {
    const { path, snapshot, canEdit } = latest.current;
    if (!canEdit || savingNow.current || !path || !snapshot || !view.current) {
      return false;
    }
    savingNow.current = true;
    setSaving(true);
    setError("");
    try {
      const startedAt = edits.current;
      const bytes = await view.current.requestSave();
      const version = await saveDocument(path, snapshot.version, bytes);
      const next = { ...snapshot, bytes, version };
      commit(next);
      view.current?.saved(next);
      if (edits.current === startedAt) {
        setDirty(false);
      }
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!paneId) {
      return;
    }
    const onRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail === paneId) {
        void saveRef.current();
      }
    };
    window.addEventListener(DOCUMENT_SAVE_REQUEST, onRequest);
    return () => window.removeEventListener(DOCUMENT_SAVE_REQUEST, onRequest);
  }, [paneId]);

  // A pane that can no longer edit (provider switched or removed) has nothing unsaved.
  useEffect(() => {
    if (!canEdit && dirty) {
      setDirty(false);
    }
  }, [canEdit]);

  // An unanswered agent request is declined when the pane goes away.
  useEffect(() => () => agentSaveRef.current?.answer(false), []);
  const agentSaveRef = useRef(agentSave);
  agentSaveRef.current = agentSave;

  /** Asks the user; declined automatically at `deadline` (ms since epoch). */
  const confirmAgentSave = (operation: string, deadline: number) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const answer = (approved: boolean) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          setAgentSave(null);
          resolve(approved);
        }
      };
      const timer = window.setTimeout(() => answer(false), Math.max(0, deadline - Date.now()));
      agentSaveRef.current?.answer(false);
      setAgentSave({ operation, answer });
    });

  return {
    dirty,
    saving,
    error,
    agentSave,
    clearError: () => setError(""),
    save,
    setDirty,
    attach: (editable: LiveDocumentView | null) => {
      view.current = editable;
    },
    /** Current values for callers outside render (agent operations). */
    live: {
      view: () => view.current,
      dirty: () => dirtyNow.current,
      canSave: () => latest.current.canEdit && Boolean(latest.current.path),
      save: () => saveRef.current(),
      confirmSave: confirmAgentSave,
    },
  };
}
