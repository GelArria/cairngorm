import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import tauriConf from "../../../src-tauri/tauri.conf.json";
import type { TileLayout } from "../model/types";

// Single source of truth for browser args: tauri.conf.json (main window).
// WebView2 requires the SAME args for every webview sharing the same
// user-data-folder; if they differ → ERROR_INVALID_STATE and the detached
// window never comes to exist (phantom detach).
const MAIN_BROWSER_ARGS = tauriConf.app.windows[0].additionalBrowserArgs;

export interface DetachedTabInfo {
  id: string;
  sessionId: string;
  openedAt?: number;
  title: string;
  shellPath?: string;
  shellArgs?: string[];
  cwd?: string;
  isAgent?: boolean;
  /** Only travels via IPC (reattach event), never in the URL. */
  shellEnv?: Record<string, string>;
  profile?: string;
}

/** Full payload that travels in the detached window URL. */
export interface DetachedPayload {
  /** Primary tab id — base of the window label `detached-{id}`. */
  id: string;
  members: DetachedTabInfo[];
  layout: TileLayout | null;
}

export function buildDetachedUrl(
  members: DetachedTabInfo[],
  layout: TileLayout | null = null,
): string {
  const baseUrl = window.location.href.split("?")[0];
  // SECURITY: Do NOT pass shellEnv in URL — it contains API keys.
  // The detached window re-attaches to the existing PTY via pty_ensure
  // which finds the session by ID and returns early (no env needed).
  // SECURITY: whitelist fields — a caller passing a full TermTab must not
  // sneak shellEnv (contains API keys) into the URL. Reattach goes through pty_ensure
  // (finds the session by ID and exits early, no env).
  const safe = members.map(
    ({ id, sessionId, openedAt, title, shellPath, shellArgs, cwd, isAgent, profile }) => ({
      id,
      sessionId,
      openedAt,
      title,
      shellPath,
      shellArgs,
      cwd,
      isAgent,
      profile,
    }),
  );
  const payload: DetachedPayload = { id: safe[0].id, members: safe, layout };
  const data = encodeURIComponent(JSON.stringify(payload));
  return `${baseUrl}?detached=${members[0].id}&data=${data}`;
}

/** One or several terminals (full split) to ONE detached window. */
export async function detachTerminalWindow(
  members: DetachedTabInfo[],
  layout: TileLayout | null = null,
): Promise<WebviewWindow | null> {
  const label = `detached-${members[0].id}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const url = buildDetachedUrl(members, layout);

  // Window grows with the grid: +400px per extra layout column/row.
  // Clamp to the REAL SCREEN (avail* excludes taskbar): at small resolutions
  // the ideal size exceeded the screen and the OS clipped the bottom band.
  const rows = layout ? Math.max(...layout.cells.map((c) => c.row + c.rowSpan)) : 1;
  const cols = layout?.columnCount ?? 1;
  const idealW = Math.min(1800, 400 * cols + 400);
  const idealH = Math.min(1400, 300 * rows + 300);

  // additionalBrowserArgs exists in WindowConfig (Rust) but the JS 2.11 API type
  // does not declare it; the runtime applies it anyway (spread into the invoke).
  const options = {
    url,
    title: `Terminal — ${members[0].title}`,
    width: Math.max(480, Math.min(idealW, window.screen.availWidth - 80)),
    height: Math.max(400, Math.min(idealH, window.screen.availHeight - 80)),
    resizable: true,
    decorations: false,
    // Settings › Transparency can show the desktop through; opaque CSS otherwise.
    transparent: true,
  };

  const win = new WebviewWindow(label, {
    ...options,
    additionalBrowserArgs: MAIN_BROWSER_ARGS,
  } as typeof options);

  return new Promise((resolve) => {
    win.once("tauri://created", () => resolve(win));
    win.once("tauri://error", () => resolve(null));
  });
}

export async function focusDetachedWindow(windowLabel: string): Promise<void> {
  const win = await WebviewWindow.getByLabel(windowLabel);
  if (win) {
    await win.setFocus();
  }
}

export async function closeDetachedWindow(windowLabel: string): Promise<void> {
  const win = await WebviewWindow.getByLabel(windowLabel);
  // destroy() instead of close(): on reattach the PTY must stay alive, so we do
  // not want the webview beforeunload; and close() may wait for the ack of a busy
  // renderer and freeze the native event loop ("Not Responding" hang seen in the battery).
  if (win) {
    await win.destroy();
  }
}

/** Payload of the `terminal-reattach` event (emitTo main ← detached window).
 *  Travels via in-memory IPC: here it CAN carry shellEnv (API keys), unlike
 *  the window URL. */
export interface ReattachPayload {
  members: DetachedTabInfo[];
  windowLabel: string;
  layout?: TileLayout | null;
}

export function getDetachedTabInfoFromUrl(): DetachedPayload | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("detached");
  const data = params.get("data");
  if (!id || !data) {
    return null;
  }
  try {
    // URLSearchParams.get() already decodes — an extra decodeURIComponent
    // corrupts the JSON if the payload contains a literal % (title/path).
    const parsed = JSON.parse(data) as Omit<DetachedPayload, "id">;
    return { ...parsed, id };
  } catch {
    return null;
  }
}

export function getDetachedTabIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("detached");
}
