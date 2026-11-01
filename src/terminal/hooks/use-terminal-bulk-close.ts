import { useState } from "preact/hooks";
import type { TermTab } from "../model/types";

interface Props {
  tabs: TermTab[];
  groupId?: string;
  groupName?: string;
  closeTab: (id: string, confirmed?: boolean) => void;
}

/** Capture the exact targets when asking, so a project switch or new tab is safe. */
export function useTerminalBulkClose({ tabs, groupId, groupName, closeTab }: Props) {
  const [pending, setPending] = useState<{ ids: string[]; name: string; others: boolean } | null>(
    null,
  );
  const terminals = tabs.filter((t) => groupId && (t.groupId ?? "g1") === groupId && !t.kind);
  const request = (keepId?: string) => {
    const ids = terminals.filter((t) => t.id !== keepId).map((t) => t.id);
    if (ids.length) {
      setPending({ ids, name: groupName ?? "this project", others: keepId !== undefined });
    }
  };
  const count = pending?.ids.length ?? 0;
  const dialog = {
    open: !!pending,
    title: pending?.others ? "Close other terminals?" : "Close all terminals?",
    message: `Close ${count} terminal${count === 1 ? "" : "s"} in ${pending?.name}? Running processes and agents will be stopped, including detached terminals. Open files will stay open.`,
    confirmLabel: `Close ${count} terminal${count === 1 ? "" : "s"}`,
    onCancel: () => setPending(null),
    onConfirm: () => {
      if (!pending) {
        return;
      }
      setPending(null);
      for (const id of pending.ids) {
        closeTab(id, true);
      }
    },
  };
  return {
    confirming: !!pending,
    count: terminals.length,
    hasOthers: (keepId: string) => terminals.some((t) => t.id !== keepId),
    closeAll: () => request(),
    closeOthers: (keepId: string) => request(keepId),
    dialog,
  };
}
