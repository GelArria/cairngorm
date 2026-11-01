import { agentEnvironment } from "../data/session-launch";
import { debugLog } from "../data/terminal-debug-logger";
import { type DetachedTabInfo } from "../data/terminal-window";
import { finalizeLayout } from "../model/layout/finalize";
import { activeInline } from "../model/layout/geometry";
import { normalizeLayout } from "../model/layout/normalize";
import { type TermTab, type TileLayout } from "../model/types";
import { advanceIdCounter } from "./id-counter";
import { currentState, setState } from "./terminal-store";

export function detachTab(id: string, windowLabel: string) {
  debugLog("tabs", "detachTab", `id=${id} win=${windowLabel}`);
  setState((prev) => {
    const tabs = prev.tabs.map((t) =>
      t.id === id ? { ...t, detached: true, detachedWindowLabel: windowLabel } : t,
    );
    // Purge the detached tab cell (leaving it corrupts the grid geometry)
    const layout = normalizeLayout(activeInline(tabs, prev.activeGroupId), prev.layout);
    // no need to exclude it from the filter)
    let activeTabId = prev.activeTabId;
    if (activeTabId === id) {
      activeTabId =
        layout?.cells[0]?.tabId ?? activeInline(tabs, prev.activeGroupId)[0]?.id ?? null;
    }
    const detachedLayouts = { ...prev.detachedLayouts };
    detachedLayouts[windowLabel] ??= {
      groupId: prev.activeGroupId,
      layout: prev.layout,
      activeTabId: prev.activeTabId,
    };
    return { ...prev, tabs, layout, activeTabId, detachedLayouts };
  });
}

/** Reattach a FULL detached group: its members come back as their own split
 *  group (the window's grid, or an automatic arrangement) and the group on
 *  screen is parked. Members with unknown ids (splits made INSIDE the detached
 *  window) are created as new tabs in main. A single member comes back alone.
 *  Exported standalone: the `terminal-reattach` listener lives in App (root,
 *  always mounted) — inside TerminalTabs it would unmount with ViewKeepAlive
 *  after 60s outside the chat and the reattach would become a silent no-op. */
export function attachGroup(members: DetachedTabInfo[], layout: TileLayout | null) {
  debugLog(
    "tabs",
    "attachGroup",
    `ids=${members.map((m) => m.id).join(",")} cells=${layout?.cells.length ?? 0}`,
  );
  setState((prev) => {
    const idSet = new Set(members.map((m) => m.id));
    let tabs = prev.tabs.map((t) =>
      idSet.has(t.id)
        ? { ...t, detached: false, detachedWindowLabel: undefined, groupId: prev.activeGroupId }
        : t,
    );
    // Splits created inside the detached window: they do not exist in the main store
    const known = new Set(prev.tabs.map((t) => t.id));
    const created: TermTab[] = members
      .filter((m) => !known.has(m.id))
      .map((m) => ({
        id: m.id,
        title: m.title,
        profile: m.profile ?? "code-assistant",
        shellPath: m.shellPath,
        shellArgs: m.shellArgs,
        shellEnv: m.shellEnv,
        cwd: m.cwd,
        status: "running" as const,
        sessionId: m.sessionId,
        openedAt: m.openedAt ?? Date.now(),
        detached: false,
        isAgent: m.isAgent,
        groupId: prev.activeGroupId,
      }));
    if (created.length) {
      tabs = [...tabs, ...created];
    }
    // The window comes back as its OWN split group (its grid), never merged into
    // the grid on screen — that one is parked. Without a grid, members return loose.
    const live = tabs.filter((t) => idSet.has(t.id) && !t.detached);
    const group = normalizeLayout(live, layout);
    const parkedLayouts = [...(prev.parkedLayouts ?? [])];
    if (group && prev.layout) {
      parkedLayouts.push(prev.layout);
    }
    // activeTabId only to live ids (a member may have been closed from the bar)
    const activeId = group?.cells[0]?.tabId ?? live[0]?.id;
    return {
      ...prev,
      tabs,
      layout: group ?? prev.layout,
      parkedLayouts,
      activeTabId: activeId ?? prev.activeTabId,
    };
  });
}

/** Keep splits/renames/closes in a detached window durable in main's snapshot. */
export function syncDetachedWorkspace(
  windowLabel: string,
  members: TermTab[],
  layout?: TileLayout | null,
  activeTabId?: string | null,
) {
  const original = currentState.tabs.find((t) => t.detachedWindowLabel === windowLabel);
  if (!original) {
    return;
  } // late event after reattach/close
  setState((prev) => ({
    ...prev,
    tabs: [
      ...prev.tabs.filter((t) => t.detachedWindowLabel !== windowLabel),
      ...members.map((t) => ({
        ...t,
        cwd: t.cwd ?? original.cwd,
        shellEnv: undefined,
        detached: true,
        detachedWindowLabel: windowLabel,
        groupId: original.groupId,
      })),
    ],
    detachedLayouts:
      layout === undefined
        ? prev.detachedLayouts
        : {
            ...prev.detachedLayouts,
            [windowLabel]: {
              groupId: original.groupId ?? prev.activeGroupId,
              layout,
              activeTabId: activeTabId ?? null,
            },
          },
  }));
}

/** Hydrates the store of a DETACHED window from its URL payload.
 *  The store is a PER-WEBVIEW singleton: the detached one is born empty. Seeds
 *  members as inline tabs of the local group + kept layout.
 *  The agent environment (API or Codex) is resolved live, never from the URL. */
export async function hydrateDetachedGroup(members: DetachedTabInfo[], layout: TileLayout | null) {
  if (currentState.tabs.length > 0) {
    return;
  } // idempotent (HMR re-mount)
  // ids/sessionIds ("2", "term-2") that collide with hydrated members →
  // pty_ensure attaches the wrong PTY (mirror panes) and closeTab kills both.
  // Large offset + random: also decouples two simultaneous detached windows.
  advanceIdCounter(1_000_000 + Math.floor(Math.random() * 100_000));
  const tabs: TermTab[] = await Promise.all(
    members.map(async (m) => ({
      id: m.id,
      title: m.title,
      profile: m.profile ?? "code-assistant",
      shellPath: m.shellPath,
      shellArgs: m.shellArgs,
      cwd: m.cwd,
      shellEnv: m.isAgent ? await agentEnvironment(m.shellArgs).catch(() => undefined) : undefined,
      status: "running",
      sessionId: m.sessionId,
      openedAt: m.openedAt ?? Date.now(),
      detached: false,
      isAgent: m.isAgent,
      groupId: "g1",
    })),
  );
  const cells = layout?.cells.filter((c) => tabs.some((t) => t.id === c.tabId)) ?? [];
  setState({
    tabs,
    layout: layout && cells.length >= 2 ? finalizeLayout({ ...layout, cells }) : null,
    activeTabId: tabs[0]?.id ?? null,
    groups: [{ id: "g1", name: "Group 1" }],
    activeGroupId: "g1",
    savedLayouts: {},
  });
}
