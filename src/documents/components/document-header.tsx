import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import type { DocumentProviderInfo } from "../model/provider";
import { fileTypeFor } from "../model/provider-match";

export function DocumentHeader({
  title,
  extension,
  provider,
  candidates,
  refreshing,
  editable = false,
  dirty = false,
  saving = false,
  onSave,
  onReload,
  onOpenWith,
  onOpenWindow,
}: {
  title: string;
  extension: string;
  provider?: DocumentProviderInfo;
  candidates: DocumentProviderInfo[];
  refreshing: boolean;
  /** The provider edits and Cairngorm can save this file. */
  editable?: boolean;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  onReload?: () => void;
  onOpenWith: (providerId: string) => void;
  /** Moves this document into its own window (absent inside a document window). */
  onOpenWindow?: () => void;
}) {
  const fileType = provider && fileTypeFor(provider, extension);
  return (
    <div
      data-testid="document-header"
      class="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs"
    >
      <Icon name="file-text" class="shrink-0 text-muted-foreground" />
      <span class="min-w-[4rem] flex-1 truncate font-medium" title={title}>
        {title}
      </span>
      {provider && (
        <span
          class="min-w-0 shrink-[4] truncate text-[11px] text-muted-foreground"
          title={provider.description}
        >
          {fileType?.label ?? extension.toUpperCase()} · {provider.name}
        </span>
      )}
      {provider && !editable && (
        <span class="shrink-0">
          <Badge variant="outline">Read-only</Badge>
        </span>
      )}
      {editable && (
        <>
          <span role="status" class="shrink-0 text-[11px] text-muted-foreground">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button
            variant="outline"
            size="xs"
            class="shrink-0"
            disabled={!dirty || saving}
            onClick={onSave}
            data-testid="document-save"
            title="Save (Ctrl+S)"
          >
            Save
          </Button>
        </>
      )}
      {candidates.length > 1 && (
        <DropdownMenu
          align="end"
          label="Open with"
          trigger={
            <Button
              variant="subtle"
              size="xs"
              class="shrink-0"
              data-testid="document-open-with"
              aria-label="Open with another provider"
            >
              Open with
              <Icon name="caret-down" class="ml-1" />
            </Button>
          }
        >
          <DropdownMenuLabel>Open with</DropdownMenuLabel>
          {candidates.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              checked={candidate.id === provider?.id}
              onClick={() => onOpenWith(candidate.id)}
            >
              {candidate.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      )}
      {onOpenWindow && (
        <Button
          variant="subtle"
          size="icon-sm"
          class="shrink-0"
          title="Open in new window"
          aria-label="Open in new window"
          onClick={onOpenWindow}
          data-testid="document-open-window"
        >
          <Icon name="arrow-square-out" />
        </Button>
      )}
      {onReload && (
        <Button
          variant="subtle"
          size="icon-sm"
          class="shrink-0"
          title="Reload from disk"
          aria-label="Reload from disk"
          disabled={refreshing}
          onClick={onReload}
        >
          <Icon
            name="arrows-clockwise"
            class={refreshing ? "motion-safe:animate-spin" : undefined}
          />
        </Button>
      )}
    </div>
  );
}
