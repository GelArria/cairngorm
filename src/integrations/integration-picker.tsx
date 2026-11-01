import { Dialog } from "@/common/ui/dialog";
import { IntegrationSettings } from "./integration-settings";

export function IntegrationPicker({
  open,
  onClose,
  onReady,
}: {
  open: boolean;
  onClose: () => void;
  onReady: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose your model connection"
      description="Use a compatible API or an optional existing CLI integration for this draft."
      class="max-w-4xl"
      data-testid="ai-provider-picker"
    >
      {open && <IntegrationSettings open onDone={onReady} doneLabel="Continue to AI summary" />}
    </Dialog>
  );
}
