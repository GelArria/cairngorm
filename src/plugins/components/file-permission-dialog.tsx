import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import type { useFilePermissions } from "../hooks/use-file-permissions";
import { FileConsentBody } from "./file-consent-body";

export function FilePermissionDialog({
  permission,
  terminalName,
  projectName,
}: {
  permission: ReturnType<typeof useFilePermissions>;
  terminalName?: string;
  projectName?: string;
}) {
  const { current, busy, error, reply } = permission;
  return (
    <Dialog
      open={!!current}
      onClose={() => {
        // A first-use question is answered only with its buttons: a stray click outside
        // must not refuse (and start the cooldown).
        if (!busy && current?.access !== "consent") {
          void reply("deny");
        }
      }}
      title={
        current?.access !== "consent"
          ? "Allow external file access?"
          : current.subject?.startsWith("app:")
            ? `Let agents run commands as you through ${current.label ?? "this application"}?`
            : "Let agents use files here?"
      }
      class="max-w-lg"
    >
      {current?.access === "consent" && (
        <FileConsentBody
          current={current}
          terminalName={terminalName}
          projectName={projectName}
          busy={busy}
          error={error}
          reply={(decision) => void reply(decision)}
        />
      )}
      {current && current.access !== "consent" && (
        <>
          <div class="space-y-3 px-5 py-4 text-xs leading-relaxed">
            <p>
              <strong>{terminalName ?? current.terminal}</strong> in{" "}
              <strong>{projectName ?? current.projectId}</strong> requests access outside its
              project (read, open or run document actions; saving still asks you separately).
            </p>
            <p class="break-all rounded-md bg-muted p-3 font-mono">{current.path}</p>
            <p>
              Operation: {current.directory ? "List folder" : "Read or open file"}. Folder approval
              includes descendant files for this terminal session only. Enabling other tools or
              plugins does not grant this access.
            </p>
            {error && (
              <p role="alert" class="text-destructive">
                {error}
              </p>
            )}
          </div>
          <div class="flex flex-wrap justify-end gap-2 px-5 pb-4">
            <Button
              autoFocus
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void reply("deny")}
            >
              Deny
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || current.directory}
              onClick={() => void reply("file")}
            >
              Allow this file
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void reply("folder")}>
              Allow this folder for this session
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
