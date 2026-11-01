import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import type { ProviderInspection } from "../model/provider";

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** What the user approves is exactly what is installed: the manifest hash is pinned. */
export function InstallReviewDialog({
  path,
  inspection,
  pending,
  onApprove,
  onCancel,
}: {
  path: string;
  inspection: ProviderInspection;
  pending: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { manifest } = inspection;
  return (
    <Dialog
      open
      onClose={() => !pending && onCancel()}
      title={inspection.replaces ? `Update ${manifest.name}?` : `Install ${manifest.name}?`}
      description="Review what this document provider declares before it runs."
      class="max-w-md"
      data-testid="document-provider-review"
    >
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 pt-4 text-xs">
        <dt class="text-muted-foreground">Provider</dt>
        <dd class="min-w-0 [overflow-wrap:anywhere]">
          {manifest.id} ·{" "}
          {inspection.replaces ? `${inspection.replaces} → ${manifest.version}` : manifest.version}
        </dd>
        {manifest.description && (
          <>
            <dt class="text-muted-foreground">About</dt>
            <dd>{manifest.description}</dd>
          </>
        )}
        <dt class="text-muted-foreground">Opens</dt>
        <dd>
          {manifest.fileTypes
            .map((type) => `${type.label} (${type.extensions.map((e) => `.${e}`).join(", ")})`)
            .join("; ")}
        </dd>
        <dt class="text-muted-foreground">Can</dt>
        <dd>
          {manifest.capabilities.includes("edit")
            ? "View and edit documents you open with it. Cairngorm saves them, checking the version and keeping a backup."
            : "View documents you open with it (read-only)."}
        </dd>
        {manifest.operations && manifest.operations.length > 0 && (
          <>
            <dt class="text-muted-foreground">Agents can</dt>
            <dd>
              {manifest.operations.map((operation) => operation.name).join(", ")}, on documents
              already open in Cairngorm
            </dd>
          </>
        )}
        <dt class="text-muted-foreground">Cannot</dt>
        <dd>
          Read other files, run commands or save changes. Its scripts can only fetch its own files.
        </dd>
        <dt class="text-muted-foreground">Files</dt>
        <dd>
          {inspection.files} files, {size(inspection.bytes)} · up to {size(manifest.maxBytes)} per
          document
        </dd>
        <dt class="text-muted-foreground">From</dt>
        <dd class="min-w-0 font-mono text-[11px] [overflow-wrap:anywhere]">{path}</dd>
      </dl>
      <p class="px-5 pt-3 text-[11px] leading-relaxed text-muted-foreground">
        The folder is copied into Cairngorm. Later changes to the original folder have no effect
        until you install it again. Install only providers you trust.
      </p>
      <div class="flex justify-end gap-2 px-5 pb-4 pt-4">
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={onApprove}
          data-testid="document-provider-approve"
        >
          {pending ? "Installing…" : inspection.replaces ? "Update" : "Install"}
        </Button>
      </div>
    </Dialog>
  );
}
