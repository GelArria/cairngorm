import { useIntegrationSettings } from "@/integrations/hooks/use-integration-settings";
// Settings ▸ AI providers: endpoint, Codex login, Claude API billing and usage display.
import { AgentScopeBadge } from "@/agent/agent-scope-badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Toggle } from "@/common/ui/toggle";
import { setShowRemaining } from "@/integrations/hooks/use-usage-display";
import {
  SettingsGroupTitle,
  SettingsPage,
  SettingsRow,
} from "@/settings/components/settings-layout";
import { CairngormAgentSection } from "./components/cairngorm-agent-section";
import { ProviderAccount } from "./components/provider-account";
import { ClaudeApiConsent } from "./components/claude-api-consent";
import { SubscriptionConsentDialog } from "./components/subscription-consent";

export function IntegrationSettings({
  open,
  onDone,
  doneLabel,
}: {
  open: boolean;
  onDone?: () => void;
  doneLabel?: string;
}) {
  const settings = useIntegrationSettings({ open, onDone });
  const { ai, usage, remaining, consent, asking, services, detected, selected, verify, answer } =
    settings;

  return (
    <SettingsPage
      title="AI providers"
      badge={<AgentScopeBadge scope="cairngorm" />}
      description="The model behind the Cairngorm agent: agent tabs, scheduled tasks, commit messages and summaries. Give it a model endpoint, use a Codex or Gemini CLI login, or enable paid Claude API requests. Agent CLIs you run in terminals keep their own logins."
      actions={
        <>
          {ai.checkedAt && (
            <span class="text-[11px] text-muted-foreground">Checked at {ai.checkedAt}</span>
          )}
          <Button variant="subtle" size="xs" disabled={ai.busy !== null} onClick={ai.scan}>
            <Icon name="arrows-clockwise" class="mr-1.5" />
            Scan again
          </Button>
        </>
      }
      data-testid="integration-settings"
      aria-busy={ai.busy !== null}
    >
      <CairngormAgentSection
        open={open}
        subscriptionName={selected?.name ?? null}
        busy={ai.busy !== null}
        onUseEndpoint={() => void ai.finish(true)}
      />
      <section aria-labelledby="ai-subscriptions" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <SettingsGroupTitle id="ai-subscriptions">CLI integrations</SettingsGroupTitle>
          <span class="text-[11px] text-muted-foreground">
            {consent === "granted"
              ? "Subscription CLIs allowed. Claude requires separate API billing consent."
              : "Logins are shown for information. Cairngorm asks before using one; Claude only with an API key."}
          </span>
        </div>
        {ai.busy === "scan" && !ai.view && (
          <p role="status" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="spinner-gap" class="animate-spin" />
            Checking installed CLIs and existing logins…
          </p>
        )}
        {!ai.view && ai.busy !== "scan" && (
          <p class="text-xs text-muted-foreground">
            Subscription status unavailable. Scan again to retry.
          </p>
        )}
        {services.length > 0 && (
          <ul class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {services.map((service) => (
              <ProviderAccount
                key={service.id}
                service={service}
                report={usage.snapshot?.reports?.find((r) => r.id === service.id)}
                selected={selected?.id === service.id}
                busy={ai.busy}
                onVerify={() => verify(service)}
                onSave={(runtime) => void ai.saveRuntime(service, runtime)}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="ai-usage-display" class="flex flex-col gap-2">
        <SettingsGroupTitle id="ai-usage-display">Usage display</SettingsGroupTitle>
        <div class="rounded-lg border border-border px-4 py-3">
          <SettingsRow
            label="Show remaining usage"
            hint="Fill limit bars with what is left instead of what has been used, here and in the footer."
          >
            <Toggle
              checked={remaining}
              aria-label="Show remaining usage"
              onCheckedChange={setShowRemaining}
            />
          </SettingsRow>
        </div>
      </section>
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        Existing CLI logins stay with their tools. Cairngorm saves runtime paths and a service
        selection; it does not export logins, copy tokens or transfer subscriptions. An API key is
        saved only when you supply one, or read from its environment variable.
      </p>
      {ai.error && (
        <p role="alert" class="break-words text-xs text-destructive">
          {ai.error}
        </p>
      )}
      {ai.notice && (
        <p role="status" class="text-xs leading-relaxed">
          {ai.notice}
        </p>
      )}
      {onDone && (
        <div class="flex justify-end border-t border-border pt-3">
          <Button
            variant={selected ? "default" : "outline"}
            size="sm"
            disabled={ai.busy !== null}
            onClick={() => void ai.finish(false)}
          >
            {doneLabel ?? "Continue to Cairngorm"}
          </Button>
        </div>
      )}
      <ClaudeApiConsent
        open={settings.claudeAsking}
        canVerify={settings.canVerifyClaude}
        onConfirm={settings.confirmClaude}
        onClose={settings.closeClaude}
      />
      <SubscriptionConsentDialog
        open={asking}
        services={detected}
        onAllow={() => answer(true)}
        onDecline={() => answer(false)}
      />
    </SettingsPage>
  );
}
