import { inAnyGroup } from "../model/layout/split-groups";
import type { TermTab } from "../model/types";
import { uid } from "./id-counter";
import { withJoined } from "./split-group-actions";
import { currentState, setState } from "./terminal-store";

export interface AppTabOptions {
  /** Terminal session whose agent drove the application. */
  sessionId: string;
  appId: string;
  appName: string;
  /** Native window handle (decimal string). */
  hwnd: string;
  title: string;
}

/**
 * One pane per terminal and application, beside its terminal, showing the application's own
 * window. Returns false when the terminal is not in this window.
 */
export function openAppTab({ sessionId, appId, appName, hwnd, title }: AppTabOptions): boolean {
  const source = currentState.tabs.find((t) => !t.kind && t.sessionId === sessionId);
  if (!source) {
    return false;
  }
  const sameWindow = hwnd && currentState.tabs.find((t) => t.kind === "app" && t.appHwnd === hwnd);
  if (sameWindow && sameWindow.appSourceTabId !== source.id) {
    // A native window cannot occupy two panes, including panes in inactive projects.
    if (sameWindow.groupId === currentState.activeGroupId) {
      setState((prev) => ({ ...prev, activeTabId: sameWindow.id }));
    }
    return true;
  }
  const existing = currentState.tabs.find(
    (t) => t.kind === "app" && t.appSourceTabId === source.id && t.appId === appId,
  );
  const id = existing?.id ?? uid();
  setState((prev) => {
    const tab: TermTab = {
      id,
      title: title || appName,
      profile: "app",
      kind: "app",
      sessionId: `app-${id}`,
      appId,
      appName,
      // A pane opened from the menu has no window until it launches; keep a live one.
      appHwnd: hwnd || existing?.appHwnd || "",
      appSourceTabId: source.id,
      status: "idle",
      openedAt: existing?.openedAt ?? Date.now(),
      detached: false,
      groupId: source.groupId ?? "g1",
    };
    const tabs = existing ? prev.tabs.map((t) => (t.id === id ? tab : t)) : [...prev.tabs, tab];
    const isActive = tab.groupId === prev.activeGroupId;
    const next =
      inAnyGroup(prev, source.id) && !inAnyGroup(prev, id)
        ? withJoined({ ...prev, tabs }, source.id, id)
        : { ...prev, tabs };
    return { ...next, activeTabId: isActive ? id : prev.activeTabId };
  });
  return true;
}

export function updateAppTabWindow(id: string, hwnd: string) {
  if (
    currentState.tabs.some((tab) => tab.kind === "app" && tab.id !== id && tab.appHwnd === hwnd)
  ) {
    throw new Error("This application window is already shown in another pane.");
  }
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((tab) =>
      tab.id === id && tab.kind === "app" ? { ...tab, appHwnd: hwnd } : tab,
    ),
  }));
}

/**
 * Opened by the user (not an agent): beside the active terminal, or the terminal the active
 * view belongs to, or the project's first terminal.
 */
export function openAppTabHere(options: Omit<AppTabOptions, "sessionId">): boolean {
  const visible = (t: { kind?: string; detached: boolean; groupId?: string }) =>
    !t.kind && !t.detached && (t.groupId ?? "g1") === currentState.activeGroupId;
  const active = currentState.tabs.find((t) => t.id === currentState.activeTabId);
  const sourceId = active?.kind
    ? (active.appSourceTabId ?? active.pluginSourceTabId ?? active.testSourceTabId)
    : active?.id;
  const source =
    currentState.tabs.find((t) => t.id === sourceId && visible(t)) ??
    currentState.tabs.find(visible);
  return !!source && openAppTab({ ...options, sessionId: source.sessionId });
}
