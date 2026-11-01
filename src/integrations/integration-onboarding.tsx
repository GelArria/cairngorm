import { Dialog } from "@/common/ui/dialog";
import { useEffect, useState } from "preact/hooks";
import { needsAiSetup } from "./data/ai-services";
import { IntegrationSettings } from "./integration-settings";

export function IntegrationOnboarding({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    needsAiSetup()
      .then((needed) => {
        if (!cancelled) {
          setOpen(needed);
        }
      })
      .catch((error) => console.error("[integrations] setup status unavailable", error));
    return () => {
      cancelled = true;
    };
  }, [ready]);
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Set up the Cairngorm agent"
      description="Cairngorm's own AI features (agent tabs, scheduled tasks, commit messages) need a provider first. Your terminals and CLIs such as Claude Code work without it. Close this to set it up later: those features stay off, and this opens again next launch."
      data-testid="integration-onboarding"
      class="max-w-4xl"
    >
      <IntegrationSettings open={open} onDone={() => setOpen(false)} />
    </Dialog>
  );
}
