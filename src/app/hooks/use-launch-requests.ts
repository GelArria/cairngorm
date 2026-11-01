// Requests from the `cairngorm` terminal command: open a project, a file, a terminal or
// an agent CLI, a panel or Settings. Native queues them until this main window takes them.
import { invoke } from "@tauri-apps/api/core";
import { openSettings, openSidebarModule } from "@/common/events/app-events";
import { catchLog } from "@/debug/data/safe";
import {
  getProjectsState,
  selectProjectFolder,
  switchProject,
  whenProjectsReady,
} from "@/projects/api";
import { openTerminalAt, startCliAt } from "@/terminal/workspace";
import { useEffect, useRef } from "preact/hooks";
import { launchTarget, type LaunchRequest } from "../model/launch-target";
import { openProjectFolder } from "../project-actions";

type OpenPath = (path: string) => Promise<void>;

async function handle(request: LaunchRequest, openPath: OpenPath, activateChat: () => void) {
  const target = launchTarget(request, getProjectsState().projects);
  if (target) {
    // A new project opens with a terminal of its own, unless an agent will be its first tab.
    let created = false;
    if (target.projectId) {
      switchProject(target.projectId);
    } else if (request.agent) {
      selectProjectFolder(target.projectFolder);
    } else {
      created = openProjectFolder(target.projectFolder);
    }
    activateChat();
    if (request.isFile && request.path) {
      await openPath(request.path);
    }
    if (request.terminal && !created) {
      openTerminalAt(target.cwd);
    }
    if (request.agent) {
      await startCliAt(request.agent, target.cwd);
    }
  }
  if (request.panel) {
    openSidebarModule(request.panel);
  }
  if (request.settings !== null) {
    openSettings(request.settings || undefined);
  }
}

export function useLaunchRequests(openPath: OpenPath, activateChat: () => void) {
  const latest = useRef({ openPath, activateChat });
  latest.current = { openPath, activateChat };

  useEffect(() => {
    let stopped = false;
    let queue = Promise.resolve();
    // One at a time and in order: each may switch the active project.
    const drain = () => {
      queue = queue
        .then(() => whenProjectsReady())
        .then(() => invoke<LaunchRequest[]>("app_take_launch_requests"))
        .then(async (requests) => {
          for (const request of requests) {
            if (!stopped) {
              const { openPath, activateChat } = latest.current;
              await handle(request, openPath, activateChat).catch(catchLog("launch"));
            }
          }
        })
        .catch(catchLog("launch"));
    };
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("app-launch-request", drain))
      .then((stop) => {
        if (stopped) {
          stop();
        } else {
          unlisten = stop;
          // Catches a request that arrived while the listener was being registered.
          drain();
        }
      })
      .catch(() => {
        /* not running in Tauri */
      });
    drain();
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
}
