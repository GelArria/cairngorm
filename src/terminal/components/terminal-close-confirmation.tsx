import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { useLayoutEffect, useState } from "preact/hooks";
import {
  answerCloseConfirmation,
  confirmWindowClose,
  getCloseConfirmation,
  subscribeCloseConfirmation,
} from "../data/close-confirmation";
import { registerStorageCloseCheck } from "../data/native-storage";
import { getTerminalTabs } from "../hooks/use-terminal-tabs";

/** Lives at the window root, so closing from any view/sidebar/shortcut is protected. */
export function TerminalCloseConfirmation() {
  const [pending, setPending] = useState(getCloseConfirmation);
  useLayoutEffect(() => {
    const unsubscribe = subscribeCloseConfirmation(() => setPending(getCloseConfirmation()));
    setPending(getCloseConfirmation());
    const unregister = registerStorageCloseCheck(() =>
      confirmWindowClose(
        getTerminalTabs(),
        new URLSearchParams(window.location.search).has("detached"),
      ),
    );
    return () => {
      unsubscribe();
      unregister();
      answerCloseConfirmation(false);
    };
  }, []);
  return (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title ?? "Close?"}
      message=""
      compact
      confirmLabel={pending?.confirmLabel}
      onCancel={() => answerCloseConfirmation(false)}
      onConfirm={() => answerCloseConfirmation(true)}
    />
  );
}
