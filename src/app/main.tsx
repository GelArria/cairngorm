import { Component, render } from "preact";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { installExternalLinks } from "@/common/navigation/external-links";
import { useState } from "preact/hooks";
import "../appearance/appearance.css";
import "../appearance/data/motion-preferences";
import "../appearance/data/store";
import "../appearance/data/transparency";
import "../appearance/transparency.css";
import { CrashProvider } from "../debug";
import { initUiHealth } from "../debug/data/ui-health";
import { IntegrationOnboarding } from "../integrations/integration-onboarding";
import { SPLASH_PREF_KEY } from "../settings/settings-dialog";
import {
  DetachedTerminalView,
  getDetachedTabIdFromUrl,
  getDetachedTabInfoFromUrl,
} from "../terminal";
import { TerminalCloseConfirmation } from "../terminal/components/terminal-close-confirmation";
import { installStorageCloseGuard } from "../terminal/data/native-storage";
import { initializeWorkspaceStorage } from "../terminal/storage";
import { startWorkspacePersistence } from "../terminal/workspace";
import { documentWindowPayload } from "../documents/data/document-window";
import { DocumentWindowView } from "../documents/document-window-view";
import App from "./app";
import { enterBackgroundOnClose, listenForBackgroundQuit } from "./background";
import { SplashScreen } from "./components/splash-screen";
import { suppressNativeChrome } from "./native-chrome";
import { startProjectActions } from "./project-actions";
import { startConfig } from "./config-startup";
import { startProjectSync } from "./project-sync";
import "./styles.css";

const documentWindow = documentWindowPayload();
const detachedInfo = getDetachedTabInfoFromUrl();
// `?detached=` present but data corrupt: do NOT mount App (double initAgent →
// extra agent PTY) — the detached window is only there to die.
const detachedBroken = !detachedInfo && getDetachedTabIdFromUrl() !== null;
const root = document.getElementById("app")!;

// Every window (main + detached): no browser right-click menu / reload keys
suppressNativeChrome();
if (isTauri()) {
  installExternalLinks();
}
// Every window follows cairngorm.json; the main window creates it when missing.
startConfig(!detachedInfo && !documentWindow);

console.log("[main] detachedInfo:", detachedInfo, "search:", window.location.search);

// Start UI health monitoring only in main window (detached windows don't need watchdog)
if (!detachedInfo && !documentWindow) {
  initUiHealth();
}

// Main window: App mounts underneath while the Cairngorm splash plays, then
// fades (Settings › Startup can turn it off).
const splashEnabled = (() => {
  try {
    return localStorage.getItem(SPLASH_PREF_KEY) !== "false";
  } catch {
    return true;
  }
})();

function Root() {
  const [splash, setSplash] = useState(splashEnabled);
  return (
    <>
      <App />
      <TerminalCloseConfirmation />
      {splash && <SplashScreen onDone={() => setSplash(false)} />}
      <IntegrationOnboarding ready={!splash} />
    </>
  );
}

class ErrorBoundary extends Component {
  state = { error: null as Error | null };
  componentDidCatch(error: Error) {
    this.setState({ error });
    console.error("[main] render error:", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div class="h-screen w-screen bg-background text-red-500 p-8 font-mono text-sm">
          <h1 class="text-lg mb-4">Detached Window Render Error</h1>
          <pre class="bg-red-950/30 p-4 rounded overflow-auto">
            {this.state.error.stack || this.state.error.message}
          </pre>
          <div class="mt-4 text-muted-foreground">Close this window and try again.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

async function bootstrap() {
  await initializeWorkspaceStorage();
  // A document window owns its own close (unsaved-edit confirmation, then back to main).
  if (!documentWindow) {
    await installStorageCloseGuard(
      !detachedInfo && !detachedBroken
        ? {
            beforeDestroy: async () => {
              await invoke("app_window_prepare_close");
              await invoke("pty_snapshot_sessions");
            },
            onCloseAborted: () => invoke("app_window_cancel_close"),
            keepRunning: enterBackgroundOnClose,
          }
        : {},
    ).catch((error) => console.error("[storage] close guard unavailable", error));
    if (!detachedInfo && !detachedBroken) {
      listenForBackgroundQuit().catch((error) =>
        console.error("[background] tray quit unavailable", error),
      );
    }
  }

  if (documentWindow) {
    // One document moved out of main: no workspace, terminals or agent startup here.
    render(
      <ErrorBoundary>
        <CrashProvider>
          <DocumentWindowView payload={documentWindow} />
        </CrashProvider>
      </ErrorBoundary>,
      root,
    );
  } else if (detachedInfo) {
    render(
      <ErrorBoundary>
        <CrashProvider>
          <DetachedTerminalView group={detachedInfo} />
          <TerminalCloseConfirmation />
        </CrashProvider>
      </ErrorBoundary>,
      root,
    );
  } else if (detachedBroken) {
    render(
      <div class="h-screen w-screen bg-background text-muted-foreground p-8 font-mono text-sm flex items-center justify-center">
        <div class="text-center space-y-2">
          <p class="text-red-400/70">Detached window payload corrupted</p>
          <p class="text-xs text-muted-foreground/50">
            Close this window and reopen the terminal from the main one.
          </p>
        </div>
      </div>,
      root,
    );
  } else {
    // Projects drive terminal groups, workspace root and git (main window only).
    // Started before render so the first terminals can wait for the project.
    startWorkspacePersistence();
    startProjectSync();
    startProjectActions();
    render(
      <ErrorBoundary>
        <CrashProvider>
          <Root />
        </CrashProvider>
      </ErrorBoundary>,
      root,
    );
  }
}
void bootstrap().catch((error) => {
  console.error("[main] startup failed", error);
  render(
    <ErrorBoundary>
      <div role="alert">Could not restore the workspace. See the application logs.</div>
    </ErrorBoundary>,
    root,
  );
});
