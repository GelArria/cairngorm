// xterm instances by session id, so UI outside the pane (its right-click menu)
// can copy the selection, paste, select all or clear.
import type { Terminal } from "@xterm/xterm";

const terms = new Map<string, Terminal>();

export const registerTerm = (sessionId: string, term: Terminal) => {
  terms.set(sessionId, term);
};
export const unregisterTerm = (sessionId: string, term: Terminal) => {
  if (terms.get(sessionId) === term) {
    terms.delete(sessionId);
  }
};
export const getTerm = (sessionId: string) => terms.get(sessionId);
