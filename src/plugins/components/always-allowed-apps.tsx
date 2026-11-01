// Applications agents may script without asking, each in one project; "Ask again" takes that back.
import { errorMessage } from "@/common/errors";
import { Button } from "@/common/ui/button";
import { useProjects } from "@/projects";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";
import type { AppGrant, PluginsState } from "../model/types";

export function AlwaysAllowedApps({
  grants,
  onState,
}: {
  grants: AppGrant[];
  onState: (state: PluginsState) => void;
}) {
  const { projects } = useProjects();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!grants.length) {
    return null;
  }
  const forget = async (grant: AppGrant) => {
    setBusy(`${grant.projectId}|${grant.app}`);
    setError("");
    try {
      onState(
        await invoke<PluginsState>("plugins_forget_app", {
          id: grant.app,
          projectId: grant.projectId,
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="space-y-1.5" data-testid="always-allowed-apps">
      <p class="text-[11px] text-muted-foreground">
        Applications agents run commands through without asking (as you, in one project):
      </p>
      <ul class="flex flex-wrap gap-1.5">
        {grants.map((grant) => {
          const project =
            projects.find((p) => p.id === grant.projectId)?.name ?? "a removed project";
          return (
            <li
              key={`${grant.projectId}|${grant.app}`}
              class="flex items-center gap-1.5 rounded-md border border-border py-0.5 pl-2 pr-0.5 text-xs"
            >
              <span>
                <span class="capitalize">{grant.app}</span>
                <span class="text-muted-foreground"> in {project}</span>
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy !== null}
                onClick={() => void forget(grant)}
                aria-label={`Ask again before agents control ${grant.app} in ${project}`}
              >
                Ask again
              </Button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" class="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
