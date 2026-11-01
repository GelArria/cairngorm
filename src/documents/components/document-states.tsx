import { openSettings } from "@/common/events/app-events";
import { Button } from "@/common/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/common/ui/empty";
import { Icon } from "@/common/ui/icon";

export function DocumentLoading({ label = "Loading document…" }: { label?: string }) {
  return (
    <div
      role="status"
      class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      <Icon name="spinner-gap" class="motion-safe:animate-spin" />
      {label}
    </div>
  );
}

/** Honest "no interpreter" state: an extension alone never implies support. */
export function NoDocumentProvider({ extension }: { extension: string }) {
  return (
    <Empty data-testid="document-no-provider" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name="file" />
        </EmptyMedia>
        <EmptyTitle>No provider for .{extension || "unknown"} files</EmptyTitle>
        <EmptyDescription>
          Cairngorm needs a document provider that understands this format. Install one from
          Settings.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={() => openSettings("documents")}>
          Document providers
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function DocumentError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Empty data-testid="document-error" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name="warning-circle" />
        </EmptyMedia>
        <EmptyTitle>Could not open document</EmptyTitle>
        <EmptyDescription role="alert">{message}</EmptyDescription>
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
