import { catchLog } from "@/debug/data/safe";
import { invoke } from "@tauri-apps/api/core";
import { confirmTabClose, needsCloseConfirmation } from "../data/close-confirmation";
import { clearScrollback } from "../data/scrollback-store";
import { debugLog } from "../data/terminal-debug-logger";
import { emitTerminalEvent } from "../data/terminal-events";
import { fillHoles } from "../model/layout/fill-holes";
import { finalizeLayout } from "../model/layout/finalize";
import { activeInline } from "../model/layout/geometry";
import { normalizeLayout } from "../model/layout/normalize";
import type { OpenTabOptions } from "../model/types";
import { type TermTab, type TileLayout } from "../model/types";
import { createTab, groupCwd } from "./tab-factory";
import { currentState, getTerminalTab, setState } from "./terminal-store";

export function openTab({
  profile = "code-assistant",
  title,
  shellPath,
  shellArgs,
  shellEnv,
  isAgent = false,
  sessionId: sessionIdOverride,
  cwd,
}: OpenTabOptions = {}) {
  debugLog(
    "tabs",
    "openTab",
    `profile=${profile} shell=${shellPath ?? "default"} isAgent=${isAgent}`,
  );
  setState((prev) => {
    const dir = cwd ?? groupCwd(prev, prev.activeGroupId);
    const tab = {
      ...createTab({
        profile: profile,
        title: title,
        shellPath: shellPath,
        shellArgs: shellArgs,
        shellEnv: shellEnv,
        isAgent: isAgent,
        sessionId: sessionIdOverride,
        cwd: dir,
      }),
      groupId: prev.activeGroupId,
    };
    const tabs = [...prev.tabs, tab];
    // No auto-layout — single view by default, split only via splitTab()
    return {
      ...prev,
      tabs,
      layout: finalizeLayout(
        normalizeLayout(activeInline(tabs, prev.activeGroupId), prev.layout) as TileLayout,
      ),
      activeTabId: tab.id,
    };
  });
}

/** New terminal (default shell) whose working directory is `cwd` ("Open in Terminal"). */
export function openTerminalAt(cwd: string) {
  const name =
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || cwd;
  openTab({ profile: "code-assistant", title: name, isAgent: false, cwd: cwd });
}

export function closeTab(id: string, confirmed = false) {
  const tab = getTerminalTab(id);
  if (!tab) {
    return;
  }
  if (confirmed || !needsCloseConfirmation(tab)) {
    closeTabNow(id);
    return;
  }
  void confirmTabClose(tab).then((approved) => {
    if (approved && getTerminalTab(id)?.sessionId === tab.sessionId) {
      closeTabNow(id);
    }
  });
}

export function closeTabNow(id: string) {
  const tab = currentState.tabs.find((t) => t.id === id);
  debugLog("tabs", "closeTab", `id=${id} detached=${tab?.detached}`);
  if (tab && !tab.kind) {
    // File tabs have no PTY/session to kill
    if (tab.detached) {
      // Signal detached window to kill PTY and close
      emitTerminalEvent(`pty-kill-${id}`, {}).catch(catchLog("terminal"));
    } else {
      invoke("pty_kill", { sessionId: tab.sessionId }).catch(catchLog("terminal"));
      clearScrollback(tab.sessionId);
    }
  }
  setState((prev) => {
    const tabs = prev.tabs.filter(
      (t) => t.id !== id && t.testSourceTabId !== id && t.pluginSourceTabId !== id,
    );
    // Purge the closed tab cell; if <2 inline remain, dissolve the split.
    // NO repack: survivors keep their position (only fully empty
    // columns/rows are compacted) — the user does not want every terminal
    // rearranging when one closes.
    let layout = normalizeLayout(activeInline(tabs, prev.activeGroupId), prev.layout);
    let activeTabId = prev.activeTabId;
    if (!tabs.some((t) => t.id === activeTabId)) {
      // Stay on the same split group when it survives, else the first tab of the project
      activeTabId =
        layout?.cells[0]?.tabId ?? activeInline(tabs, prev.activeGroupId)[0]?.id ?? null;
    }
    // Groups are projects: they persist with zero terminals (empty grid).
    if (layout) {
      // Smart stretching: contiguous neighbors absorb the gap
      // (without rearranging: nobody changes cells, only spans grow).
      fillHoles(layout.cells, layout.columnCount);
      layout = finalizeLayout(layout);
    }
    return { ...prev, tabs, layout, activeTabId };
  });
}

export function renameTab(id: string, title: string) {
  const clean = title.trim();
  if (!clean) {
    return;
  }
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) => (t.id === id ? { ...t, title: clean.slice(0, 40) } : t)),
  }));
}

export function updateTabStatus(id: string, status: TermTab["status"]) {
  const tab = currentState.tabs.find((t) => t.id === id);
  if (tab && tab.status === status) {
    return;
  }
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) => (t.id === id ? { ...t, status } : t)),
  }));
}

export function restartTab(id: string) {
  const tab = currentState.tabs.find((t) => t.id === id);
  if (tab?.kind) {
    return;
  } // panes without a PTY have nothing to restart
  if (tab) {
    invoke("pty_kill", { sessionId: tab.sessionId }).catch(catchLog("terminal"));
  }
  // Generate new session ID, update --session-id arg if agent tab
  const newSid = `term-${crypto.randomUUID()}`;
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) => {
      if (t.id !== id) {
        return t;
      }
      let fixedArgs = t.shellArgs;
      if (t.isAgent && t.shellArgs) {
        const sidIdx = t.shellArgs.indexOf("--session-id");
        if (sidIdx >= 0 && sidIdx + 1 < t.shellArgs.length) {
          fixedArgs = [...t.shellArgs];
          fixedArgs[sidIdx + 1] = newSid;
        }
      }
      return { ...t, sessionId: newSid, shellArgs: fixedArgs, status: "running" as const };
    }),
    activeTabId: id,
  }));
}
