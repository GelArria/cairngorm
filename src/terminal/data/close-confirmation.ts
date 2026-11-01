import type { TermTab } from "../model/types";

export const CLOSE_CONFIRM_AFTER_MS = 5 * 60_000;

export interface CloseConfirmation {
  title: string;
  confirmLabel: string;
}

let pending: CloseConfirmation | null = null;
let resolvePending: ((confirmed: boolean) => void) | undefined;
const listeners = new Set<() => void>();
export const getCloseConfirmation = () => pending;
export function subscribeCloseConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function needsCloseConfirmation(tab: TermTab, now = Date.now()): boolean {
  // Only real terminals own processes; files and derived panes close directly.
  return (
    !tab.kind && Number.isFinite(tab.openedAt) && now - tab.openedAt! >= CLOSE_CONFIRM_AFTER_MS
  );
}

export function askToClose(confirmation: CloseConfirmation): Promise<boolean> {
  // Repeated clicks/shortcuts must never replace the original target.
  if (pending) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    pending = confirmation;
    resolvePending = resolve;
    listeners.forEach((listener) => listener());
  });
}

export function answerCloseConfirmation(confirmed: boolean) {
  const resolve = resolvePending;
  pending = null;
  resolvePending = undefined;
  listeners.forEach((listener) => listener());
  resolve?.(confirmed);
}

export function confirmTabClose(tab: TermTab): Promise<boolean> {
  if (tab.kind) {
    return Promise.resolve(true);
  }
  return askToClose({ title: "Close terminal?", confirmLabel: "Close terminal" });
}

export function confirmWindowClose(tabs: TermTab[], detached: boolean): Promise<boolean> {
  // Closing main ends the app, and with it every document window and its unsaved edits.
  if (!detached && tabs.some((tab) => tab.kind === "file" && tab.detached && tab.isDirty)) {
    return askToClose({
      title: "Close Cairngorm? A document window has unsaved changes.",
      confirmLabel: "Close and discard",
    });
  }
  if (!tabs.some((tab) => needsCloseConfirmation(tab))) {
    return Promise.resolve(true);
  }
  return askToClose({
    title: detached ? "Close terminal window?" : "Close Cairngorm?",
    confirmLabel: detached ? "Close window" : "Close Cairngorm",
  });
}
