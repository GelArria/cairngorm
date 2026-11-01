import { errorMessage } from "@/common/errors";
import { Step, UpdateCheck, releasePage } from "@/updates/model/update-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";

export function useUpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  useEffect(() => {
    if (!open) {
      return;
    }
    setStatus(null);
    setError(null);
    setStep("idle");
    // A check from an earlier opening may answer late: only this opening's counts.
    let current = true;
    invoke<UpdateCheck>("update_check")
      .then((found) => {
        if (current) {
          setStatus(found);
          // Already downloaded: offer the restart instead of a second download.
          setStep(found.ready ? "ready" : "idle");
        }
      })
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [open]);

  const run = async (command: string, next: Step) => {
    setError(null);
    try {
      await invoke(command);
      setStep(next);
    } catch (e) {
      setError(errorMessage(e));
      setStep(step === "downloading" ? "idle" : step);
    }
  };
  // A download in progress keeps the dialog open: it must not finish unattended.
  const close = () => step !== "downloading" && onClose();
  const page = releasePage(status?.page);
  const available = status?.state === "available";
  return { status, error, step, setStep, run, close, page, available };
}
