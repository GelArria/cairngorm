// Title-bar warning shown while saved data falls back from the SQLite database. It stays
// until restart (the condition does not clear itself) and takes no layout space otherwise.
import {
  onStorageFallback,
  storageFallbackMessage,
  storageFallbacks,
} from "@/common/storage/storage-health";
import { Button } from "@/common/ui/button";
import { DropdownMenu } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { useEffect, useState } from "preact/hooks";

export function StorageWarning() {
  const [areas, setAreas] = useState(storageFallbacks);
  useEffect(() => {
    setAreas(storageFallbacks());
    return onStorageFallback(() => setAreas(storageFallbacks()));
  }, []);
  const message = storageFallbackMessage(areas);
  if (!message) {
    return null;
  }
  return (
    <DropdownMenu
      align="end"
      label="Saving problem"
      trigger={
        <Tooltip content="Changes may not be saved">
          <Button
            variant="subtle"
            size="icon"
            class="h-7 w-7 text-amber-400 hover:text-amber-300"
            data-tauri-no-drag-region
            data-testid="storage-warning"
            aria-label="Changes may not be saved"
          >
            <Icon name="warning" class="text-sm" />
          </Button>
        </Tooltip>
      }
    >
      <p role="alert" class="max-w-[300px] select-text px-2.5 py-2 text-xs leading-snug">
        {message}
      </p>
    </DropdownMenu>
  );
}
