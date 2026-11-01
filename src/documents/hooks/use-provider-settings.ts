// Settings ▸ Documents: review a provider folder, approve and install it, or remove it.
import { errorMessage } from "@/common/errors";
import { openFolderDialog } from "@/common/filesystem/fs-bridge";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";
import { forgetProviderChoice } from "../data/provider-preferences";
import { reloadProviders } from "../data/provider-registry";
import type { ProviderInspection } from "../model/provider";
import { useDocumentProviders, useProviderChoices } from "./use-document-providers";

export function useProviderSettings() {
  const registry = useDocumentProviders();
  const choices = useProviderChoices();
  const [review, setReview] = useState<{ path: string; inspection: ProviderInspection } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const chooseFolder = async () => {
    setError("");
    const path = await openFolderDialog();
    if (!path) {
      return;
    }
    try {
      setReview({
        path,
        inspection: await invoke<ProviderInspection>("document_provider_inspect", { path }),
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const approve = async () => {
    if (!review) {
      return;
    }
    setPending(true);
    try {
      await invoke("document_provider_install", {
        path: review.path,
        approvalHash: review.inspection.approvalHash,
      });
      setReview(null);
      await reloadProviders();
    } catch (e) {
      setError(errorMessage(e));
      setReview(null);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!removing) {
      return;
    }
    setPending(true);
    try {
      await invoke("document_provider_remove", { id: removing });
      await reloadProviders();
      setRemoving(null);
    } catch (e) {
      setError(errorMessage(e));
      setRemoving(null);
    } finally {
      setPending(false);
    }
  };

  return {
    registry,
    choices,
    review,
    pending,
    error,
    removing,
    chooseFolder,
    approve,
    cancelReview: () => setReview(null),
    askRemove: setRemoving,
    remove,
    cancelRemove: () => setRemoving(null),
    forgetChoice: forgetProviderChoice,
  };
}
