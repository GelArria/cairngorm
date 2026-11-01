import { ContextMenu } from "@/common/components/context-menu";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
// The selected project's terminals (live status, focus, rename, restart).
import { requestNewProject } from "@/common/events/app-events";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups as menuGroups } from "@/common/model/context-menu";
import { PromptDialog } from "@/common/ui/prompt-dialog";
import { useActiveProject } from "@/projects/api";
import { useAgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { useState } from "preact/hooks";
import { useTerminalBulkClose } from "../../terminal/dialogs";
import { useTerminalGroups } from "../../terminal/workspace";
import { useTerminalMarks } from "../hooks/use-terminal-elapsed";
import { terminalPlace, useWorkspaceInfo } from "../hooks/use-workspace-label";
import { SidebarEmpty } from "./sidebar-empty";
import { TerminalRow } from "./terminal-row";

const showGrid = () => window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));

/** Group mini-label: "Agents · 2" — count only, no divider line. */
function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <div class="px-2.5 pb-0.5 pt-1.5 text-[11px] leading-4 text-muted-foreground">
      {label} <span class="text-muted-foreground/60">· {count}</span>
    </div>
  );
}

export function ProjectTerminals({ onNewTerminal }: { onNewTerminal: () => void }) {
  const project = useActiveProject();
  const {
    tabs: allTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    renameTab,
    restartTab,
  } = useTerminalGroups();
  const agentRun = useAgentRunStatus();
  useTerminalMarks(allTabs, agentRun);
  const workspace = useWorkspaceInfo();
  const cm = useContextMenu();
  const [renamingTab, setRenamingTab] = useState<{ id: string; title: string } | null>(null);
  // Real terminals and agents only — open files live in the tab bar, not here
  const tabs = allTabs.filter((t) => t.groupId === project?.id && !t.kind);
  const bulk = useTerminalBulkClose({
    tabs: allTabs,
    groupId: project?.id,
    groupName: project?.name,
    closeTab,
  });
  const agents = tabs.filter((t) => t.isAgent);
  const shells = tabs.filter((t) => !t.isAgent);
  // grouped only pays off with a mix; a single-kind list needs no labels
  const heads = agents.length > 0 && shells.length > 0;

  const focus = (id: string) => {
    setActiveTab(id);
    showGrid();
  };
  const tabMenu = (e: MouseEvent, tab: (typeof tabs)[number]) =>
    cm.open(
      e,
      menuGroups(
        [
          { label: "Focus", action: () => focus(tab.id) },
          { label: "Rename…", action: () => setRenamingTab({ id: tab.id, title: tab.title }) },
        ],
        [{ label: "Restart", action: () => restartTab(tab.id), disabled: tab.detached }],
        [
          { label: "Close Terminal", danger: true, action: () => closeTab(tab.id) },
          {
            label: "Close other terminals…",
            danger: true,
            action: () => bulk.closeOthers(tab.id),
            disabled: !bulk.hasOthers(tab.id),
          },
          { label: "Close all terminals…", danger: true, action: bulk.closeAll },
        ],
      ),
    );

  const row = (list: typeof tabs) =>
    list.map((t, i) => (
      <TerminalRow
        key={t.id}
        tab={t}
        groupId={t.groupId ?? ""}
        index={i + 1}
        active={t.id === activeTabId}
        agentRun={agentRun[t.sessionId]}
        {...terminalPlace(t.cwd, workspace)}
        onFocus={() => focus(t.id)}
        onContextMenu={(e) => tabMenu(e, t)}
      />
    ));

  return (
    <div
      class="flex flex-1 flex-col pb-1 pt-1"
      data-testid="project-terminals"
      onContextMenu={(e) =>
        cm.open(
          e,
          menuGroups(
            [
              { label: "New Terminal", action: onNewTerminal },
              { label: "Open", action: () => requestNewProject() },
            ],
            [
              {
                label: "Close all terminals…",
                action: bulk.closeAll,
                danger: true,
                disabled: bulk.count === 0,
              },
            ],
          ),
        )
      }
    >
      {heads ? (
        <>
          <SectionHead label="Agents" count={agents.length} />
          {row(agents)}
          <SectionHead label="Terminals" count={shells.length} />
          {row(shells)}
        </>
      ) : (
        row(tabs)
      )}
      {tabs.length === 0 && (
        <SidebarEmpty
          testId="project-terminals-empty"
          icon="terminal-window"
          title="Nothing open yet"
          description="Open a shell to work in this project."
          action="New terminal"
          onAction={onNewTerminal}
          shortcut="newTerminalInPane"
        />
      )}
      <ContextMenu menu={cm.menu} />
      <ConfirmDialog {...bulk.dialog} />
      <PromptDialog
        open={!!renamingTab}
        title="Rename Terminal"
        label="Name"
        initial={renamingTab?.title}
        confirmLabel="Rename"
        onCancel={() => setRenamingTab(null)}
        onSubmit={(v) => {
          if (renamingTab) {
            renameTab(renamingTab.id, v);
          }
          setRenamingTab(null);
        }}
      />
    </div>
  );
}
