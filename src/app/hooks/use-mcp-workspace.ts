import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "preact/hooks";
import type { TerminalState } from "@/terminal/types";
import { errorMessage } from "@/common/errors";

/** Only App owns scope synchronization; inactive projects and detached sources remain mapped. */
export function useMcpWorkspace(state: TerminalState) {
  const pending = useRef(Promise.resolve());
  const terminals = state.tabs
    .filter((tab) => !tab.kind)
    .flatMap((tab) => {
      const project = state.groups.find((group) => group.id === (tab.groupId ?? "g1"));
      return project?.cwd
        ? [{ sessionId: tab.sessionId, projectId: project.id, rootPath: project.cwd }]
        : [];
    });
  const dirtyPaths = state.tabs
    .filter((tab) => tab.kind === "file" && tab.isDirty && tab.fullPath)
    .map((tab) => tab.fullPath!);
  const snapshot = JSON.stringify({ terminals, dirtyPaths });
  useEffect(() => {
    // IPC completion order must not let an old project mapping overwrite a newer one.
    pending.current = pending.current
      .then(() => invoke<void>("plugins_sync_workspace", JSON.parse(snapshot)))
      .catch((error) =>
        console.error("[plugins] Could not synchronize file scopes", errorMessage(error)),
      );
  }, [snapshot]);
}
