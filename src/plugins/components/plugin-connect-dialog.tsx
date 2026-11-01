import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";

export function PluginConnectDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title="Connect plugins to your agents" class="max-w-md">
      <div class="space-y-3 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          Cairngorm will add one shared connection to your installed, supported agents. Your other
          tools and settings stay unchanged, and configuration backups are kept.
        </p>
        <p>
          Ask your agent to use a plugin normally. Interactive tools open beside its terminal.
          Agents already running need to be restarted or reloaded once.
        </p>
        <p>Adding more plugins will use the same connection.</p>
      </div>
      <div class="flex justify-end gap-2 px-5 pb-4">
        <Button variant="outline" size="sm" autoFocus onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onConfirm}>
          Connect agents
        </Button>
      </div>
    </Dialog>
  );
}
