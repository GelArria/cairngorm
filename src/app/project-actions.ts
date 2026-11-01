import { APP_NEW_PROJECT, onAppEvent } from "@/common/events/app-events";
import { openFolderDialog } from "@/common/filesystem/fs-bridge";
import { catchLog } from "@/debug/data/safe";
import { selectProjectFolder } from "@/projects/api";
import { openTerminalAt } from "@/terminal/workspace";

/** Compose project selection, terminal launch, and navigation in one app-owned flow.
 * Returns true when a new project was created (it opens with a terminal). */
export function openProjectFolder(folder: string): boolean {
  const { created } = selectProjectFolder(folder);
  if (!created) {
    return false;
  }
  openTerminalAt(folder);
  window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));
  return true;
}

async function pickAndCreateProject(): Promise<void> {
  const folder = await openFolderDialog();
  if (folder) {
    openProjectFolder(folder);
  }
}

let stop: (() => void) | undefined;

/** Main-window request handler; modules can request this flow without importing app code. */
export function startProjectActions(): () => void {
  if (stop) {
    return stop;
  }
  const unlisten = onAppEvent(APP_NEW_PROJECT, () => {
    void pickAndCreateProject().catch(catchLog("projects"));
  });
  stop = () => {
    unlisten();
    stop = undefined;
  };
  return stop;
}
