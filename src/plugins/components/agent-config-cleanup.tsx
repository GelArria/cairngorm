// Takes Cairngorm out of other agents' configurations (session hooks, session plugins, the
// Claude Code status line relay and MCP bridge entries), or adds the hooks back.
import { errorMessage } from "@/common/errors";
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { SettingsGroupTitle } from "@/settings/components/settings-layout";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";

interface AgentCleanupReport {
  errors: string[];
  removed: boolean;
}

export function AgentConfigCleanup({ open, onChanged }: { open: boolean; onChanged: () => void }) {
  const [removed, setRemoved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    let live = true;
    invoke<boolean>("agent_configs_removed")
      .then((value) => live && setRemoved(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);
  const run = async (command: "agent_configs_remove" | "agent_configs_restore") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const report = await invoke<AgentCleanupReport>(command);
      setRemoved(report.removed);
      if (report.errors.length) {
        setError(`Some configurations need a manual edit: ${report.errors.join("; ")}`);
      } else {
        setNotice(
          report.removed
            ? "Removed. Restart running agents for the change to apply."
            : "Session hooks restored. Use Connect agents to add the plugin bridge again.",
        );
      }
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <section
      aria-labelledby="agent-config-cleanup"
      class="flex flex-col gap-2"
      data-testid="agent-config-cleanup"
    >
      <SettingsGroupTitle id="agent-config-cleanup">Cairngorm in agent configs</SettingsGroupTitle>
      <p class="text-[11px] leading-snug text-muted-foreground">
        Cairngorm adds a session hook to installed agent CLIs (to restore sessions after a restart),
        a status line relay to Claude Code (to show usage limits) and, once connected, its plugin
        bridge. Removing them keeps everything else in those files; uninstalling Cairngorm with
        “Delete app data” checked removes them too.
      </p>
      <div>
        {removed ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run("agent_configs_restore")}
          >
            Add session hooks back
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            Remove Cairngorm from agent configs
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" class="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" class="text-xs">
          {notice}
        </p>
      )}
      <ConfirmDialog
        open={open && confirming}
        title="Remove Cairngorm from agent configs?"
        message="Session hooks, the Claude Code status line relay and the plugin bridge are removed from every agent CLI. Agent sessions will no longer be restored after a restart, usage limits stop updating and agents lose Cairngorm tools until you add them back."
        confirmLabel="Remove"
        pending={busy}
        onConfirm={() => void run("agent_configs_remove")}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
