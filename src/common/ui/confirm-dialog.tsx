// Confirmation on top of the shared Dialog (Esc, focus trap, overlay close).
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  compact?: boolean;
  error?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  compact = false,
  error,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) {
          onCancel();
        }
      }}
      title={title}
      compact={compact}
      class={compact ? "max-w-xs" : "max-w-sm"}
      data-testid="confirm-dialog"
    >
      {message && <p class="px-5 pt-4 text-xs leading-relaxed text-muted-foreground">{message}</p>}
      {error && (
        <p role="alert" class="px-5 pt-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <div
        class={
          compact
            ? "flex justify-end gap-2 px-3 pb-3 pt-3"
            : "flex justify-end gap-2 px-5 pb-4 pt-4"
        }
      >
        <Button variant="outline" size="sm" autoFocus disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
