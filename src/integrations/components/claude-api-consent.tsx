import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { useEffect, useState } from "preact/hooks";

export function ClaudeApiConsent({
  open,
  canVerify,
  onConfirm,
  onClose,
}: {
  open: boolean;
  canVerify: boolean;
  onConfirm: (acknowledgement: string) => void;
  onClose: () => void;
}) {
  const [acknowledgement, setAcknowledgement] = useState("");
  useEffect(() => {
    setAcknowledgement("");
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Claude Code uses paid API billing"
      description="This is not included in a Claude Free, Pro or Max subscription."
      class="max-w-md"
    >
      <div class="flex flex-col gap-4 px-5 py-4 text-xs leading-relaxed">
        <p>
          Automatic Cairngorm requests, including verification, use your Anthropic Console API key
          and incur API charges. Subscription logins are not accepted for this integration.
        </p>
        <p>
          Anthropic requires API authentication for third-party product integrations. Manually
          running the unmodified Claude Code CLI in your own terminal is unchanged.
        </p>
        <a
          class="underline underline-offset-2"
          href="https://code.claude.com/docs/en/legal-and-compliance"
          target="_blank"
          rel="noreferrer"
        >
          Anthropic legal and compliance policy
        </a>
        {!canVerify && (
          <p role="status">
            Set ANTHROPIC_API_KEY in Cairngorm's environment and scan again before enabling this
            integration.
          </p>
        )}
        <label class="flex flex-col gap-2" for="claude-api-acknowledgement">
          Type I understand to authorize API billing
          <Input
            id="claude-api-acknowledgement"
            value={acknowledgement}
            autoComplete="off"
            onInput={(event) => setAcknowledgement(event.currentTarget.value)}
          />
        </label>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button
            size="sm"
            disabled={!canVerify || acknowledgement !== "I understand"}
            onClick={() => onConfirm(acknowledgement)}
          >
            Verify &amp; enable API billing
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
