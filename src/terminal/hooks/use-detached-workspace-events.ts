import { listen } from "@tauri-apps/api/event";
import { useEffect } from "preact/hooks";
import { closeDetachedWindow, type ReattachPayload } from "../data/terminal-window";
import type { TermTab, TileLayout } from "../model/types";
import { attachGroup, syncDetachedWorkspace } from "../state/detached-workspace";

export function useDetachedWorkspaceEvents() {
  // `terminal-reattach` listener at App level (root, ALWAYS mounted): the
  // detached window emits the reattach — if it lived in TerminalTabs,
  // ViewKeepAlive would unmount it after 60s outside the chat → silent no-op
  // and orphaned PTYs.
  useEffect(() => {
    let un: (() => void) | null = null;
    (async () => {
      try {
        un = await listen<ReattachPayload>("terminal-reattach", (e) => {
          attachGroup(e.payload.members ?? [], e.payload.layout ?? null);
          closeDetachedWindow(e.payload.windowLabel).catch(() => {
            /* already closed */
          });
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      un?.();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    listen<{
      windowLabel: string;
      members: TermTab[];
      layout: TileLayout | null;
      activeTabId: string | null;
    }>("terminal-detached-state", (e) => {
      syncDetachedWorkspace(
        e.payload.windowLabel,
        e.payload.members,
        e.payload.layout,
        e.payload.activeTabId,
      );
    })
      .then((un) => {
        if (stopped) {
          un();
        } else {
          unlisten = un;
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
}
