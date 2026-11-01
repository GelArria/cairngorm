// Background mode: closing the main window while terminals still work hides Cairngorm in
// the tray instead, so agents keep running and reattach live when it comes back. Quit from
// the tray runs the normal close. See app/native/background.rs.
import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/config";

/** A tray quit applies to the close it starts, not to a later one if that close never ran. */
const QUIT_WINDOW_MS = 10_000;
let quitRequestedAt = 0;

/** `app.keepRunning` in cairngorm.json; on unless set to false. */
export function keepsRunningInBackground(): boolean {
  const app = getConfig().app as { keepRunning?: unknown } | undefined;
  return app?.keepRunning !== false;
}

/** The close guard's first step: true when the app was hidden rather than closed. */
export async function enterBackgroundOnClose(): Promise<boolean> {
  // A tray quit applies to this one close; a canceled quit leaves the setting in charge.
  const quitting = Date.now() - quitRequestedAt < QUIT_WINDOW_MS;
  quitRequestedAt = 0;
  if (quitting) {
    return false;
  }
  if (!keepsRunningInBackground()) {
    return false;
  }
  try {
    if ((await invoke<number>("pty_busy_count")) === 0) {
      return false;
    }
    await invoke("app_background_enter");
  } catch (error) {
    // Without a way back, close as before rather than leave an unreachable app.
    console.error("[background] could not keep running; closing normally", error);
    return false;
  }
  // The native close request already released docked applications; let panes dock again.
  await invoke("app_window_cancel_close").catch(() => {});
  return true;
}

/** Quit in the tray menu closes main through its usual guard. Answering tells the native
 *  side not to stop the terminals itself, which it does when this page cannot answer. */
export async function listenForBackgroundQuit(): Promise<void> {
  const [{ listen }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  await listen("app-quit-requested", () => {
    quitRequestedAt = Date.now();
    void invoke("app_background_quit_started").catch(() => {});
    void getCurrentWindow().close();
  });
}
