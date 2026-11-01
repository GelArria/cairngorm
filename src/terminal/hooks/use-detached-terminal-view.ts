import { getWindowPlatform } from "@/common/ui/window-controls";
import { useKeybinds } from "@/keybindings/hooks/use-keybinds";
import { flushStorage, registerStorageCloseCleanup } from "@/terminal/data/native-storage";
import { clearScrollback } from "@/terminal/data/scrollback-store";
import { emitTerminalEvent } from "@/terminal/data/terminal-events";
import type { DetachedTabInfo } from "@/terminal/data/terminal-window";
import { useDetachedCloseEvents } from "@/terminal/hooks/use-detached-close-events";
import { hydrateDetachedGroup, useTerminalTabs } from "@/terminal/hooks/use-terminal-tabs";
import { DetachedTerminalViewProps } from "@/terminal/model/terminal-detached-view";
import { cancelPendingTerminalAttachments } from "@/terminal/runtime/terminal-attachment";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export function useDetachedTerminalView({ group }: DetachedTerminalViewProps) {
  const { state, closeTab } = useTerminalTabs();
  const windowLabel = `detached-${group.id}`;
  const reattachingRef = useRef(false);
  const closingRef = useRef(false);
  const lastReattachRef = useRef(0);
  const [ready, setReady] = useState(false);
  const platform = getWindowPlatform();
  const macos = platform === "macos";

  // One-time hydration of the local store (idempotent across HMR re-mounts)
  useEffect(() => {
    let cancelled = false;
    hydrateDetachedGroup(group.members, group.layout).then(() => {
      if (!cancelled && !closingRef.current) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inlineTabs = state.tabs.filter((t) => !t.detached);
  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  useDetachedCloseEvents(state.tabs, closeTab);

  const handleReattach = useCallback(async () => {
    const now = Date.now();
    if (now - lastReattachRef.current < 500) {
      return;
    }
    lastReattachRef.current = now;
    reattachingRef.current = true;
    // Commit history before handing PTY ownership back to main.
    // Then stop every local PTY listener before main mounts its terminals.
    window.dispatchEvent(new CustomEvent("terminal-save-scrollback"));
    // LIVE members (local splits included) with env/profile from the local store
    // (travels via IPC, not URL) + current layout → main reattaches/creates them.
    const members: DetachedTabInfo[] = inlineTabs.map(
      ({
        id,
        sessionId,
        openedAt,
        title,
        shellPath,
        shellArgs,
        shellEnv,
        cwd,
        isAgent,
        profile,
      }) => ({
        id,
        sessionId,
        openedAt,
        title,
        shellPath,
        shellArgs,
        shellEnv,
        cwd,
        isAgent,
        profile,
      }),
    );
    try {
      await flushStorage();
      window.dispatchEvent(new CustomEvent("terminal-detach-pty"));
      // Keep the existing IPC detach grace period before main mounts and destroys this webview.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await emitTerminalEvent(
        "terminal-reattach",
        { members, windowLabel, layout: state.layout },
        "main",
      );
    } catch {
      // main may be gone: the window is still here — let X kill the PTYs
      reattachingRef.current = false;
    }
  }, [inlineTabs, state.layout, windowLabel]);

  useKeybinds({ reattach: ready ? handleReattach : undefined });

  useEffect(() => {
    // Native destroy bypasses beforeunload; the storage guard must await cleanup first.
    const cleanup = async () => {
      if (reattachingRef.current) {
        return;
      }
      closingRef.current = true;
      setReady(false);
      try {
        // Unmount panes and drain pending starts before killing; late starts must not revive them.
        await cancelPendingTerminalAttachments();
        const terminals = tabsRef.current.length
          ? tabsRef.current.filter((t) => !t.detached && !t.kind)
          : group.members;
        await Promise.all(terminals.map((t) => invoke("pty_kill", { sessionId: t.sessionId })));
        terminals.forEach((t) => clearScrollback(t.sessionId));
        await flushStorage();
        await emitTerminalEvent(
          "terminal-detached-state",
          { windowLabel, members: [], layout: null, activeTabId: null },
          "main",
        ).catch(() => {
          /* main may already be closed */
        });
      } catch (error) {
        closingRef.current = false;
        setReady(true);
        throw error;
      }
    };
    const unregisterCleanup = registerStorageCloseCleanup(cleanup);
    const handleBeforeUnload = () => {
      void cleanup().catch((error) => console.error("[detached] close cleanup failed", error));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unregisterCleanup();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Everything closed (from the main bar or here) → the window is surplus
  useEffect(() => {
    if (ready && state.tabs.length === 0) {
      window.close();
    }
  }, [ready, state.tabs.length]);

  // Live title: if the first tab is closed here, don’t show a dead title.
  // Falls back to the payload while hydrating.
  const title = state.tabs[0]?.title ?? group.members[0]?.title ?? "Terminal";
  return { ready, platform, macos, inlineTabs, handleReattach, title };
}
