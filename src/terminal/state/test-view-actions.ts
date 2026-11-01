import { animateTestTab } from "../../testing/data/animate-test-tab";
import { activeInline } from "../model/layout/geometry";
import { inAnyGroup } from "../model/layout/split-groups";
import type { TermTab } from "../model/types";
import { uid } from "./id-counter";
import { withJoined } from "./split-group-actions";
import { currentState, setState } from "./terminal-store";

/** Reopening a hidden observer preserves its identity and all session-local state. */
export function openTestsTab(sessionId: string) {
  const source = currentState.tabs.find((t) => !t.kind && t.sessionId === sessionId);
  if (!source) {
    return;
  }
  const existing = currentState.tabs.find(
    (t) => t.kind === "tests" && t.testSourceTabId === source.id,
  );
  const id = existing?.id ?? uid();
  if (!existing && (source.groupId ?? "g1") === currentState.activeGroupId) {
    animateTestTab(source.id, id);
  }
  setState((prev) => {
    const tab: TermTab = existing
      ? { ...existing, hidden: false, testSessionId: sessionId }
      : {
          id,
          title: `Tests · ${source.title}`,
          profile: "tests",
          kind: "tests",
          sessionId: `tests-${id}`,
          testSessionId: sessionId,
          testSourceTabId: source.id,
          status: "idle",
          openedAt: Date.now(),
          detached: false,
          groupId: source.groupId ?? "g1",
        };
    const tabs = existing ? prev.tabs.map((t) => (t.id === id ? tab : t)) : [...prev.tabs, tab];
    const next =
      inAnyGroup(prev, source.id) && !inAnyGroup(prev, id)
        ? withJoined({ ...prev, tabs }, source.id, id)
        : { ...prev, tabs };
    return {
      ...next,
      activeTabId: tab.groupId === prev.activeGroupId && !tab.detached ? id : prev.activeTabId,
    };
  });
}

export function hideTestsTabs() {
  setState((prev) => {
    const tabs = prev.tabs.map((t) =>
      t.kind === "tests" && !t.detached ? { ...t, hidden: true } : t,
    );
    const active = tabs.find((t) => t.id === prev.activeTabId);
    const visible = activeInline(tabs, prev.activeGroupId);
    const fallback = visible.find((t) => t.id === active?.testSourceTabId) ?? visible[0];
    return {
      ...prev,
      tabs,
      activeTabId: active?.hidden ? (fallback?.id ?? null) : prev.activeTabId,
    };
  });
}

export function showHiddenTestsTabs() {
  setState((prev) => {
    const tabs = prev.tabs.map((t) =>
      t.kind === "tests" && t.hidden ? { ...t, hidden: false } : t,
    );
    const visible = activeInline(tabs, prev.activeGroupId);
    return {
      ...prev,
      tabs,
      activeTabId: visible.some((t) => t.id === prev.activeTabId)
        ? prev.activeTabId
        : (visible[0]?.id ?? null),
    };
  });
}
