import { DropdownMenuItem, DropdownMenuLabel } from "@/common/ui/dropdown-menu";
import { useState } from "preact/hooks";
import { catalogProfile, startProfile } from "../data/cli-launch";
import { useCliCatalog } from "../hooks/use-cli-launch";
import { useTerminalPreferences } from "../hooks/use-terminal-preferences";
import type { LaunchProfile } from "../model/launch-profile";
import type { OpenTabOptions } from "../model/types";

export function CliLaunchItems({ onOpen }: { onOpen: (options: OpenTabOptions) => void }) {
  const { clis, error, scanning, rescan } = useCliCatalog();
  const { launchProfiles } = useTerminalPreferences();
  const [busy, setBusy] = useState(false);
  const launch = async (profile: LaunchProfile) => {
    setBusy(true);
    try {
      await startProfile(profile, onOpen);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div class="-mx-1 my-1 h-px bg-border" />
      <DropdownMenuLabel>Agent CLIs</DropdownMenuLabel>
      {clis.map((cli) => (
        <DropdownMenuItem
          key={cli.id}
          disabled={busy}
          onClick={() => void launch(catalogProfile(cli))}
        >
          {cli.name}
        </DropdownMenuItem>
      ))}
      {!clis.length && (
        <p class="px-2 py-1 text-xs text-muted-foreground">
          {scanning ? "Detecting CLIs…" : "No installed CLIs detected"}
        </p>
      )}
      {!!launchProfiles.length && <DropdownMenuLabel>Launch profiles</DropdownMenuLabel>}
      {launchProfiles.map((profile) => (
        <DropdownMenuItem key={profile.id} disabled={busy} onClick={() => void launch(profile)}>
          {profile.name}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem disabled={scanning} onClick={() => void rescan()}>
        Detect CLIs again
      </DropdownMenuItem>
      {error && (
        <p role="alert" class="max-w-72 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
