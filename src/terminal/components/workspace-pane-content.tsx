import { AppWindowPane } from "../../plugins/app-window-pane";
import { PluginPane } from "../../plugins/plugin-pane";
import { TestPane } from "../../testing/test-pane";
import { useAgentEvents } from "../hooks/use-agent-events";
import { useTerminalTabs } from "../hooks/use-terminal-tabs";
import type { ChatViewMode } from "../shared/agent-events";
import { updateAppTabWindow } from "../state/app-tab-actions";
import { ChatUIView } from "./chat-ui-view";
import { FilePaneView } from "./file-pane";
import { TerminalTab } from "./terminal-tab";

import type { TermTab } from "../model/types";

interface Props {
  tab: TermTab;
  workspace: ReturnType<typeof useTerminalTabs>;
  agent: ReturnType<typeof useAgentEvents>;
  paneMode: ChatViewMode;
  isActive: boolean;
  handleFocusDetached: (label: string) => void;
}
export function WorkspacePaneContent({
  tab,
  workspace,
  agent,
  paneMode,
  isActive,
  handleFocusDetached,
}: Props) {
  const { state, setActiveTab, updateFileContent, updateTabStatus, restartTab } = workspace;
  const sessionId = tab.isAgent ? tab.sessionId : undefined;
  const sessionEvents = sessionId && sessionId.length > 0 ? agent.getEvents(sessionId) : [];
  return (
    <>
      {/* File pane: CodeEditor/ImageViewer in the same grid (splits, drag & zoom apply) */}
      {tab.kind === "file" ? (
        <div class="absolute inset-0">
          <FilePaneView tab={tab} onChange={updateFileContent} />
        </div>
      ) : tab.kind === "tests" ? (
        <div class="absolute inset-0">
          <TestPane
            key={tab.testSessionId}
            sessionId={tab.testSessionId!}
            sourceTitle={state.tabs.find((t) => t.id === tab.testSourceTabId)?.title ?? "Terminal"}
            onShowTerminal={() => {
              const source = state.tabs.find((t) => t.id === tab.testSourceTabId);
              if (source?.detachedWindowLabel) {
                handleFocusDetached(source.detachedWindowLabel);
              } else if (source) {
                setActiveTab(source.id);
              }
            }}
          />
        </div>
      ) : tab.kind === "app" ? (
        <div class="absolute inset-0">
          <AppWindowPane
            hwnd={tab.appHwnd ?? ""}
            appId={tab.appId ?? ""}
            onReopened={(hwnd) => updateAppTabWindow(tab.id, hwnd)}
            appName={tab.appName ?? "Application"}
            sourceTitle={state.tabs.find((t) => t.id === tab.appSourceTabId)?.title ?? "Terminal"}
            onShowTerminal={() => {
              const source = state.tabs.find((t) => t.id === tab.appSourceTabId);
              if (source) setActiveTab(source.id);
            }}
          />
        </div>
      ) : tab.kind === "plugin" ? (
        <div class="absolute inset-0">
          <PluginPane
            callId={tab.pluginCallId}
            pluginId={tab.pluginId ?? "plugin"}
            sourceTitle={
              state.tabs.find((t) => t.id === tab.pluginSourceTabId)?.title ?? "Terminal"
            }
            onShowTerminal={() => {
              const source = state.tabs.find((t) => t.id === tab.pluginSourceTabId);
              if (source?.detachedWindowLabel) {
                handleFocusDetached(source.detachedWindowLabel);
              } else if (source) {
                setActiveTab(source.id);
              }
            }}
          />
        </div>
      ) : (
        <>
          {/* TUI stays mounted (display toggle) — PTY state survives pane flips.
                      Non-agent tabs (powershell/git bash) are NOT part of the chat/toggle
                      logic — they always show their terminal. */}
          <div
            class="absolute inset-0 flex flex-col animate-in fade-in duration-150"
            style={{ display: paneMode === "tui" || !sessionId ? "flex" : "none" }}
          >
            <TerminalTab
              active={isActive}
              sessionId={tab.sessionId}
              projectId={tab.groupId}
              shellPath={tab.shellPath}
              shellArgs={tab.shellArgs}
              shellEnv={tab.shellEnv}
              cwd={tab.cwd}
              isAgent={tab.isAgent}
              onStatusChange={(status) => updateTabStatus(tab.id, status)}
              onRestart={() => restartTab(tab.id)}
            />
          </div>
          {sessionId && (
            // Chat UI — this pane only; other panes keep their own view
            <div
              class="absolute inset-0 flex flex-col animate-in fade-in duration-150"
              style={{ display: paneMode === "chat" ? "flex" : "none" }}
            >
              <ChatUIView
                sessionId={sessionId}
                events={sessionEvents}
                status={agent.getStatus(sessionId)}
                onSend={(text) => {
                  void agent.sendPrompt(
                    sessionId,
                    text,
                    tab.shellPath
                      ? {
                          shell: tab.shellPath,
                          args: tab.shellArgs,
                          env: tab.shellEnv,
                          cwd: tab.cwd,
                        }
                      : undefined,
                  );
                }}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
