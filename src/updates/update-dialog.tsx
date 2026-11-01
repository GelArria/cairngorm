import { useUpdateDialog } from "@/updates/hooks/use-update-dialog";
// Help ▸ Check for Updates…: asks the native updater about the release channel. A newer,
// signed installer is downloaded and verified first; "Restart to install" then closes
// Cairngorm the usual way (unsaved work is asked about) and the installer takes over.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Icon } from "@/common/ui/icon";
import { open as openLink } from "@tauri-apps/plugin-shell";

export type { UpdateCheck } from "./model/update-dialog";

export function UpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, error, step, setStep, run, close, page } = useUpdateDialog({ open, onClose });
  const available = status?.state === "available";

  return (
    <Dialog open={open} onClose={close} title="Software update" data-testid="update-dialog" compact>
      <div class="flex flex-col gap-3 px-5 pb-5 pt-1 text-xs">
        {!status && !error && (
          <p role="status" class="flex items-center gap-2 text-muted-foreground">
            <Icon name="spinner-gap" class="motion-safe:animate-spin" />
            Checking for updates…
          </p>
        )}
        {status?.state === "disabled" && (
          <>
            <p class="font-medium text-foreground">Automatic updates aren't active yet.</p>
            <p class="leading-relaxed text-muted-foreground">
              Cairngorm will update itself from the{" "}
              <span class="font-mono text-foreground">
                {status.repo}@{status.branch}
              </span>{" "}
              release channel once it is published. You're on version{" "}
              <span class="font-mono text-foreground">{status.current}</span>.
            </p>
          </>
        )}
        {status?.state === "current" && (
          <p class="flex items-center gap-2 text-foreground">
            <Icon name="check-circle" class="text-emerald-500" />
            You're up to date — version <span class="font-mono">{status.current}</span>.
          </p>
        )}
        {available && (
          <>
            <p class="font-medium text-foreground">
              Version <span class="font-mono">{status.version}</span> is available (you have{" "}
              <span class="font-mono">{status.current}</span>).
            </p>
            {status.notes && (
              <pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
                {status.notes}
              </pre>
            )}
            {step === "ready" && (
              <p role="status" class="flex items-center gap-2 text-foreground">
                <Icon name="check-circle" class="text-emerald-500" />
                Downloaded and verified. Restart to install now, or it installs the next time you
                quit Cairngorm.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" class="rounded-md bg-destructive/10 px-2.5 py-2 text-destructive">
            {error}
          </p>
        )}
        <div class="mt-1 flex justify-end gap-2">
          {available && !status.installable && page && (
            <Button size="sm" variant="outline" onClick={() => void openLink(page)}>
              Open release page
            </Button>
          )}
          {available && status.installable && step !== "ready" && (
            <Button
              size="sm"
              disabled={step === "downloading"}
              onClick={() => {
                setStep("downloading");
                void run("update_install", "ready");
              }}
            >
              {step === "downloading" ? "Downloading and verifying…" : "Download update"}
            </Button>
          )}
          {step === "ready" && (
            <Button size="sm" onClick={() => void run("update_restart", "ready")}>
              Restart to install
            </Button>
          )}
          <Button
            size="sm"
            variant={available ? "ghost" : "outline"}
            disabled={step === "downloading"}
            onClick={close}
          >
            {available ? "Later" : "Close"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
