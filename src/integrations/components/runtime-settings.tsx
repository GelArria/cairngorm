import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { useEffect, useState } from "preact/hooks";
import type { AiRuntime, AiService } from "../data/ai-services";

export function RuntimeSettings({
  service,
  busy,
  onSave,
  onDirtyChange,
}: {
  service: AiService;
  busy: boolean;
  onSave: (runtime: AiRuntime) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [binaryPath, setBinaryPath] = useState(service.runtime.binaryPath);
  const [homePath, setHomePath] = useState(service.runtime.homePath);
  useEffect(() => {
    setBinaryPath(service.runtime.binaryPath);
    setHomePath(service.runtime.homePath);
  }, [service.runtime.binaryPath, service.runtime.homePath]);
  const dirty = binaryPath !== service.runtime.binaryPath || homePath !== service.runtime.homePath;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty]);
  const id = service.id;
  const env = { codex: "CODEX_HOME", gemini: "GEMINI_CLI_HOME", claude: "CLAUDE_CONFIG_DIR" }[id];
  return (
    <form
      class="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) {
          onSave({ binaryPath, homePath });
        }
      }}
      data-testid={`runtime-${id}`}
    >
      <h5 class="mb-2 text-xs font-medium text-muted-foreground">Runtime</h5>
      <div class="divide-y divide-border rounded-md border border-border">
        <div class="grid gap-3 p-4 lg:grid-cols-[1fr_260px] lg:items-start">
          <div>
            <Label for={`${id}-binary`} class="text-xs font-semibold">
              Binary path
            </Label>
            <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Official CLI executable or command name. Leave empty for automatic detection.
            </p>
          </div>
          <div class="min-w-0">
            <Input
              id={`${id}-binary`}
              class="h-8 font-mono text-xs"
              value={binaryPath}
              placeholder={`Auto-detect ${id}`}
              spellcheck={false}
              disabled={busy}
              onInput={(e) => setBinaryPath(e.currentTarget.value)}
            />
            <p class="mt-1 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
              {service.cliPath ?? "No executable resolved"}
            </p>
          </div>
        </div>
        <div class="grid gap-3 p-4 lg:grid-cols-[1fr_260px] lg:items-start">
          <div>
            <Label for={`${id}-home`} class="text-xs font-semibold">
              {env} path
            </Label>
            <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {id === "gemini"
                ? "The existing .gemini folder, or the GEMINI_CLI_HOME folder that contains it. Leave empty to use the CLI's default."
                : "Existing provider configuration and login folder. Leave empty to use the CLI's default."}
            </p>
          </div>
          <div class="min-w-0">
            <Input
              id={`${id}-home`}
              class="h-8 font-mono text-xs"
              value={homePath}
              placeholder={service.homePath}
              spellcheck={false}
              disabled={busy}
              onInput={(e) => setHomePath(e.currentTarget.value)}
            />
            <p class="mt-1 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
              {service.homePath}
            </p>
          </div>
        </div>
      </div>
      <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Only paths are saved. Changing them deselects this CLI for commits; verify the new setup
        before using it. Existing logins are never copied.
      </p>
      <div class="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || (!binaryPath && !homePath)}
          onClick={() => {
            setBinaryPath("");
            setHomePath("");
          }}
        >
          Use automatic detection
        </Button>
        <Button variant="outline" size="sm" type="submit" disabled={busy || !dirty}>
          Save paths & scan
        </Button>
      </div>
    </form>
  );
}
