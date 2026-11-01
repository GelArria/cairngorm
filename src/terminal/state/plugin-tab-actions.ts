import { animateTestTab } from "../../testing/data/animate-test-tab";
import { inAnyGroup } from "../model/layout/split-groups";
import type { TermTab } from "../model/types";
import { uid } from "./id-counter";
import { withJoined } from "./split-group-actions";
import { currentState, setState } from "./terminal-store";

export interface PluginTabOptions {
  /** Terminal session that made the call. */
  sessionId: string;
  pluginId: string;
  pluginName: string;
  callId: string;
}

/**
 * One view tab per terminal and plugin, beside its terminal; each call replaces its view.
 * Returns false when the terminal is not in this window.
 */
export function openPluginTab({
  sessionId,
  pluginId,
  pluginName,
  callId,
}: PluginTabOptions): boolean {
  const source = currentState.tabs.find((t) => !t.kind && t.sessionId === sessionId);
  if (!source) {
    return false;
  }
  const existing = currentState.tabs.find(
    (t) => t.kind === "plugin" && t.pluginSourceTabId === source.id && t.pluginId === pluginId,
  );
  const id = existing?.id ?? uid();
  if (!existing && (source.groupId ?? "g1") === currentState.activeGroupId) {
    animateTestTab(source.id, id);
  }
  setState((prev) => {
    const tab: TermTab = {
      id,
      title: `${pluginName} · ${source.title}`,
      profile: "plugin",
      kind: "plugin",
      sessionId: `plugin-${id}`,
      pluginId,
      pluginCallId: callId,
      pluginSourceTabId: source.id,
      status: "idle",
      openedAt: existing?.openedAt ?? Date.now(),
      detached: false,
      groupId: source.groupId ?? "g1",
    };
    const tabs = existing ? prev.tabs.map((t) => (t.id === id ? tab : t)) : [...prev.tabs, tab];
    const isActive = tab.groupId === prev.activeGroupId;
    // A source inside a split group gets the view beside it; a lone source
    // shows the view on its own (the view's Terminal button switches back).
    const next =
      inAnyGroup(prev, source.id) && !inAnyGroup(prev, id)
        ? withJoined({ ...prev, tabs }, source.id, id)
        : { ...prev, tabs };
    return { ...next, activeTabId: isActive ? id : prev.activeTabId };
  });
  return true;
}
