// Ask for one line of text (new file name, rename…) on top of the shared Dialog.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { useLayoutEffect, useState } from "preact/hooks";

interface Props {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to keep the dialog open, or nothing to accept. */
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel = "OK",
  validate,
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    if (open) {
      setValue(initial);
    }
  }, [open, initial]);
  const trimmed = value.trim();
  const error = trimmed ? validate?.(trimmed) : undefined;
  const submit = (e: Event) => {
    e.preventDefault();
    if (trimmed && !error) {
      onSubmit(trimmed);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      class="max-w-sm"
      data-testid="prompt-dialog"
    >
      <form class="flex flex-col gap-3 px-5 py-4" onSubmit={submit}>
        <div>
          <Label for="prompt-input">{label}</Label>
          <Input
            id="prompt-input"
            class="h-8 text-[13px]"
            value={value}
            placeholder={placeholder}
            autoFocus
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
          {error && (
            <p class="mt-1.5 text-[11px] text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!trimmed || !!error}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
