import { catchLog } from "@/debug/data/safe";
import { listen } from "@tauri-apps/api/event";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { TermTab } from "../model/types";

interface Subscription {
  active: boolean;
  unlisten?: () => void;
}

/** Keep listeners for live members, including terminals created after detaching. */
export function useDetachedCloseEvents(
  tabs: TermTab[],
  closeTab: (id: string, confirmed?: boolean) => void,
) {
  const subscriptions = useRef(new Map<string, Subscription>());
  const latest = useRef({ tabs, closeTab });
  latest.current = { tabs, closeTab };
  const members = JSON.stringify(tabs.filter((t) => !t.detached).map((t) => t.id));
  const dispose = (entry: Subscription) => {
    entry.active = false;
    entry.unlisten?.();
  };

  useLayoutEffect(() => {
    const ids = new Set<string>(JSON.parse(members));
    const current = subscriptions.current;
    for (const [id, entry] of current) {
      if (!ids.has(id)) {
        dispose(entry);
        current.delete(id);
      }
    }
    for (const id of ids) {
      if (current.has(id)) {
        continue;
      }
      const entry: Subscription = { active: true };
      current.set(id, entry);
      void listen(`pty-kill-${id}`, () => {
        if (entry.active && latest.current.tabs.some((t) => t.id === id && !t.detached)) {
          latest.current.closeTab(id, true);
        }
      })
        .then((unlisten) => {
          if (entry.active) {
            entry.unlisten = unlisten;
          } else {
            unlisten();
          }
        })
        .catch(catchLog("terminal"));
    }
  }, [members]);

  useLayoutEffect(
    () => () => {
      for (const entry of subscriptions.current.values()) {
        dispose(entry);
      }
      subscriptions.current.clear();
    },
    [],
  );
}
