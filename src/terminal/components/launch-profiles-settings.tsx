import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { useState } from "preact/hooks";
import { cliProfile } from "../data/cli-launch";
import { setTerminalPreferences } from "../data/terminal-preferences";
import { useCliCatalog } from "../hooks/use-cli-launch";
import { useTerminalPreferences } from "../hooks/use-terminal-preferences";
import { profileHosts, shellIdentity, type LaunchProfile } from "../model/launch-profile";
import type { DetectedShell } from "../model/types";

export function LaunchProfilesSettings({ shells }: { shells: DetectedShell[] }) {
  const { launchProfiles } = useTerminalPreferences();
  const { clis, error, scanning, rescan } = useCliCatalog();
  const [draft, setDraft] = useState<LaunchProfile | null>(null);
  const hosts = profileHosts(shells);
  const save = () => {
    if (!draft?.name.trim() || !draft.program.trim()) {
      return;
    }
    setTerminalPreferences({
      launchProfiles: [
        ...launchProfiles.filter((p) => p.id !== draft.id),
        { ...draft, name: draft.name.trim() },
      ],
    });
    setDraft(null);
  };
  return (
    <section
      class="flex flex-col gap-2 border-t border-border pt-3"
      aria-labelledby="launch-profiles-title"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="launch-profiles-title" class="text-xs font-medium">
          Launch profiles
        </h3>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            setDraft({ id: crypto.randomUUID(), name: "", program: "", args: [], shell: null })
          }
        >
          Add profile
        </Button>
      </div>
      <p class="text-[11px] text-muted-foreground">
        Named CLI launches. Arguments are literal values, not shell commands. Existing terminals are
        never changed.
      </p>
      {launchProfiles.map((p) => (
        <div key={p.id} class="flex min-w-0 items-center gap-2 text-xs">
          <span class="min-w-0 flex-1 truncate" title={p.program}>
            {p.name}
          </span>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Edit ${p.name}`}
            onClick={() => setDraft({ ...p, args: [...p.args] })}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Delete ${p.name}`}
            onClick={() =>
              setTerminalPreferences({
                launchProfiles: launchProfiles.filter((item) => item.id !== p.id),
              })
            }
          >
            Delete
          </Button>
        </div>
      ))}
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" disabled={scanning} onClick={() => void rescan()}>
          {scanning ? "Detecting CLIs…" : "Detect CLIs again"}
        </Button>
        {clis.map((cli) => (
          <Button
            key={cli.id}
            variant="ghost"
            size="xs"
            onClick={() => setDraft({ ...cliProfile(cli), id: crypto.randomUUID() })}
          >
            Add {cli.name} profile
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" class="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={!!draft} onClose={() => setDraft(null)} title="Launch profile">
        {draft && (
          <form
            class="flex flex-col gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div class="flex flex-col gap-1">
              <Label htmlFor="launch-name">Name</Label>
              <Input
                id="launch-name"
                autoFocus
                value={draft.name}
                onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                required
                maxLength={128}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label htmlFor="launch-program">Executable</Label>
              <Input
                id="launch-program"
                value={draft.program}
                onInput={(e) => setDraft({ ...draft, program: e.currentTarget.value })}
                required
                placeholder="Absolute path or command on PATH"
              />
            </div>
            <fieldset class="flex min-w-0 flex-col gap-2">
              <legend class="mb-1 text-xs font-medium">Arguments</legend>
              {draft.args.map((arg, index) => (
                <div key={index} class="flex gap-2">
                  <Input
                    aria-label={`Argument ${index + 1}`}
                    value={arg}
                    onInput={(e) =>
                      setDraft({
                        ...draft,
                        args: draft.args.map((v, i) => (i === index ? e.currentTarget.value : v)),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Remove argument ${index + 1}`}
                    onClick={() =>
                      setDraft({ ...draft, args: draft.args.filter((_, i) => i !== index) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="xs"
                class="self-start"
                onClick={() => setDraft({ ...draft, args: [...draft.args, ""] })}
              >
                Add argument
              </Button>
            </fieldset>
            <div class="flex items-center justify-between gap-3">
              <Label>Shell</Label>
              <DropdownMenu
                trigger={
                  <Button type="button" variant="outline" size="sm">
                    {draft.shell
                      ? (hosts.find((h) => shellIdentity(h) === shellIdentity(draft.shell!))
                          ?.name ?? draft.shell.path)
                      : "Direct"}
                  </Button>
                }
              >
                <DropdownMenuItem
                  checked={!draft.shell}
                  onClick={() => setDraft({ ...draft, shell: null })}
                >
                  Direct
                </DropdownMenuItem>
                {hosts.map((h) => (
                  <DropdownMenuItem
                    key={shellIdentity(h)}
                    checked={!!draft.shell && shellIdentity(h) === shellIdentity(draft.shell)}
                    onClick={() => setDraft({ ...draft, shell: { path: h.path, args: h.args } })}
                  >
                    {h.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            </div>
            <p class="text-[11px] text-muted-foreground">
              Do not put API keys here. Use your CLI's credential configuration. Direct launches
              close when the CLI exits; supported shell hosts remain open.
            </p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!draft.name.trim() || !draft.program.trim()}
              >
                Save profile
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
