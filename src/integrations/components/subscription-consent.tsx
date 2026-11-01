// Codex and Gemini CLI consent is separate from Claude's native-enforced API billing acknowledgement.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import type { AiService } from "../data/ai-services";
import { ProviderLogo } from "./provider-logo";

export function SubscriptionConsentDialog({
  open,
  services,
  onAllow,
  onDecline,
}: {
  open: boolean;
  /** Signed-in subscriptions found by the last scan. */
  services: AiService[];
  onAllow: () => void;
  onDecline: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onDecline}
      title="Use your existing subscriptions?"
      description="Cairngorm found these signed-in plans on this machine."
      class="max-w-md"
      data-testid="subscription-consent"
    >
      <div class="flex flex-col gap-4 px-5 py-4">
        <ul class="flex flex-col divide-y divide-border rounded-lg border border-border">
          {services.map((service) => (
            <li key={service.id} class="flex items-center gap-3 px-3 py-2.5">
              <span class="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40">
                <ProviderLogo id={service.id} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold">{service.name}</div>
                <div class="text-[11px] text-muted-foreground">
                  {service.authKind === "subscription"
                    ? "Subscription login"
                    : "API or custom-provider login"}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <ul class="flex list-disc flex-col gap-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            If you allow it, the Cairngorm agent can run these plans through their official CLI with
            the login you already have.
          </li>
          <li>Requests count toward that plan's limits. Nothing is sent until you verify one.</li>
          <li>Logins and tokens stay with each CLI; Cairngorm never copies or exports them.</li>
          {services.some((service) => service.id === "gemini") && (
            <li>
              Google may restrict accounts that use a Gemini CLI Google login from other apps. A
              Gemini API key avoids this.
            </li>
          )}
        </ul>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onDecline}>
            Not now
          </Button>
          <Button size="sm" autoFocus onClick={onAllow}>
            Allow
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
