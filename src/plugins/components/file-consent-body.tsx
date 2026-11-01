// First use of agent file tools from a terminal: allow always, for this terminal, or not.
import { Button } from "@/common/ui/button";
import type { FilePermission } from "../hooks/use-file-permissions";

export function FileConsentBody({
  current,
  terminalName,
  projectName,
  busy,
  error,
  reply,
}: {
  current: FilePermission;
  terminalName?: string;
  projectName?: string;
  busy: boolean;
  error: string;
  reply: (decision: "deny" | "always" | "session") => void;
}) {
  const app = current.subject?.startsWith("app:") ? (current.label ?? current.subject) : null;
  const terminal = <strong>{terminalName ?? current.terminal}</strong>;
  return (
    <>
      <div class="space-y-3 px-5 py-4 text-xs leading-relaxed">
        {app ? (
          <>
            <p>
              An agent in {terminal} wants to run commands as you through <strong>{app}</strong>:
              scripts that use its automation features (open and change documents, add charts,
              export…).
            </p>
            <p class="text-muted-foreground">
              A script is not limited to {app}: it runs with your user account's permissions and can
              do anything you can, starting in <span class="font-mono">{current.rootPath}</span>.
              Only allow agents you trust. “Always” applies to agents in{" "}
              <strong>{projectName ?? current.projectId}</strong> only; other projects and
              applications ask separately. You can take it back in Settings ▸ Plugins.
            </p>
            {current.script && (
              <div class="space-y-1">
                <p class="font-medium">Script this agent wants to run now:</p>
                <pre
                  class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[11px]"
                  data-testid="consent-script"
                >
                  {current.script}
                </pre>
                <p class="text-muted-foreground">
                  Later scripts are not shown again once you allow this terminal or project.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p>
              An agent in {terminal} wants to work with files in{" "}
              <strong>{projectName ?? current.projectId}</strong>: list folders, read text, create
              documents and open them in Cairngorm panes.
            </p>
            <p class="break-all rounded-md bg-muted p-3 font-mono">{current.rootPath}</p>
            <p class="text-muted-foreground">
              Files outside this folder still ask separately, and every save an agent requests needs
              your approval in the document's pane. “Always” lets agents in every project use their
              own project's files without asking. You can change this in Settings ▸ Plugins.
            </p>
          </>
        )}
        {error && (
          <p role="alert" class="text-destructive">
            {error}
          </p>
        )}
      </div>
      <div class="flex flex-wrap justify-end gap-2 px-5 pb-4">
        {/* Focus stays off the grants: a stray Enter while typing must not allow anything. */}
        <Button autoFocus variant="outline" size="sm" disabled={busy} onClick={() => reply("deny")}>
          Don't allow
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => reply("session")}
          data-testid="file-consent-session"
        >
          Allow for this terminal
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => reply("always")}
          data-testid="file-consent-always"
        >
          {app ? "Always allow in this project" : "Always allow in all projects"}
        </Button>
      </div>
    </>
  );
}
