import { Props } from "@/debug/model/use-crash-dialog";
import { useState } from "preact/hooks";

export function useCrashDialog({ report }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("exit_app");
    } catch {
      window.close();
    }
  };
  return { copied, handleCopy, handleClose };
}
