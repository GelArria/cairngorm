// Settings ▸ General: where cairngorm.json lives, open it in Cairngorm, and its status.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { SettingsRow, SettingsSection } from "@/settings/components/settings-layout";
import { openDiskFile } from "@/workspace/data/open-file";
import { useEffect, useState } from "preact/hooks";
import { getConfigError, getConfigPath, subscribeConfig } from "../data/config-store";

export function SettingsFileSection({ onOpened }: { onOpened?: () => void }) {
  const [, setVersion] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => subscribeConfig(() => setVersion((v) => v + 1)), []);
  const path = getConfigPath();
  const problem = getConfigError();
  const open = async () => {
    setError("");
    try {
      await openDiskFile("cairngorm.json", ["cairngorm.json"], path);
      onOpened?.();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <SettingsSection title="Settings file">
      <SettingsRow
        label="cairngorm.json"
        hint={
          <>
            Shells, agent CLIs, applications, launch profiles, terminal options and “open with”
            choices in one file. Saved changes apply right away. Permissions are not stored here.
            {path && <span class="mt-1 block break-all font-mono text-[11px]">{path}</span>}
          </>
        }
      >
        <Button
          size="sm"
          variant="outline"
          disabled={!path}
          onClick={() => void open()}
          data-testid="open-settings-file"
        >
          <Icon name="file-code" class="mr-1.5" />
          Edit cairngorm.json
        </Button>
      </SettingsRow>
      {(problem || error) && (
        <p role="alert" class="text-xs text-destructive" data-testid="settings-file-error">
          {problem || error}
        </p>
      )}
    </SettingsSection>
  );
}
