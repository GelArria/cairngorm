// CLI integration status, the Verify action and configurable runtime paths.
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import { useState } from "preact/hooks";
import type { AiRuntime, AiService } from "../data/ai-services";
import { lastSeenLabel, type UsageReport } from "../data/ai-usage";
import { ProviderLogo } from "./provider-logo";
import { RuntimeSettings } from "./runtime-settings";
import { UsageMeter } from "./usage-meter";

export const serviceLabels: Record<AiService["status"], string> = {
  "session-detected": "Login detected",
  "signed-out": "Sign-in needed",
  "not-installed": "CLI not found",
  "check-failed": "Check failed",
  "api-key-required": "API key required",
};

const DOTS: Record<AiService["status"], string> = {
  "session-detected": "bg-emerald-500",
  "signed-out": "bg-amber-500",
  "not-installed": "bg-muted-foreground/60",
  "check-failed": "bg-destructive",
  "api-key-required": "bg-amber-500",
};

/** What selecting this subscription powers, stated plainly. */
const ROLE: Record<AiService["id"], string> = {
  codex: "Runs Cairngorm agent sessions and commit messages with your Codex plan.",
  gemini:
    "Runs Cairngorm agent sessions and commit messages with your Google AI plan through Gemini CLI.",
  claude:
    "Writes commit messages using paid Anthropic API billing only; agent sessions keep the endpoint above.",
};

export function ProviderAccount({
  service,
  report,
  selected,
  busy,
  onVerify,
  onSave,
}: {
  service: AiService;
  report: UsageReport | undefined;
  selected: boolean;
  busy: string | null;
  onVerify: () => void;
  onSave: (runtime: AiRuntime) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const windows = report?.windows ?? [];
  const plan = report?.plan ?? service.login?.plan;
  const claude = service.id === "claude";
  // Claude: the detected login is shown, but only an API key lets Cairngorm use it.
  const loginLabel = !claude
    ? serviceLabels[service.status]
    : service.login
      ? "Login detected"
      : service.status === "not-installed" || service.status === "check-failed"
        ? serviceLabels[service.status]
        : "No login detected";
  const loginDot = claude
    ? service.login
      ? DOTS["session-detected"]
      : DOTS[service.status === "check-failed" ? "check-failed" : "not-installed"]
    : DOTS[service.status];
  return (
    <li data-testid={`integration-${service.id}`} aria-label={`${service.name} integration`}>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <ProviderLogo id={service.id} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[13px] font-semibold">{service.name}</span>
            {plan && (
              <Badge variant="muted" class="capitalize">
                {plan}
              </Badge>
            )}
            {selected && <Badge variant="secondary">In use by Cairngorm</Badge>}
          </div>
          <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden="true" class={cn("size-1.5 rounded-full", loginDot)} />
            {loginLabel}
            {claude && service.login && !service.login.subscription && " · API or custom login"}
            {!claude &&
              service.authKind === "api-or-custom" &&
              " · API login, separate billing may apply"}
          </div>
          {claude &&
            (service.status === "session-detected" || service.status === "api-key-required") && (
              <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  aria-hidden="true"
                  class={cn("size-1.5 rounded-full", DOTS[service.status])}
                />
                {service.status === "session-detected"
                  ? "Cairngorm agent: API key detected"
                  : service.login
                    ? "Cairngorm agent: needs an API key, not this login"
                    : "Cairngorm agent: needs an API key"}
              </div>
            )}
        </div>
        <div class="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={selected ? "outline" : "default"}
            disabled={busy !== null || dirty || service.status !== "session-detected"}
            onClick={onVerify}
          >
            {busy === service.id ? "Verifying…" : selected ? "Verify again" : "Verify & use"}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            class="gap-1"
            aria-expanded={open}
            aria-controls={`runtime-panel-${service.id}`}
            onClick={() => setOpen(!open)}
          >
            Configure
            <Icon name={open ? "caret-up" : "caret-down"} class="text-xs" />
          </Button>
        </div>
      </div>
      {(windows.length > 0 || report?.error || report?.note) && (
        <div class="grid gap-4 px-4 pb-3 pl-16 sm:grid-cols-2">
          {report?.error ? (
            <p class="text-[11px] text-destructive">{report.error}</p>
          ) : windows.length > 0 ? (
            <>
              {windows.map((w) => (
                <UsageMeter key={w.label} window={w} />
              ))}
              {report?.warning && (
                <p class="text-[11px] text-destructive sm:col-span-2">{report.warning}</p>
              )}
              {report && lastSeenLabel(report) && (
                <p class="text-[11px] text-muted-foreground sm:col-span-2">
                  {lastSeenLabel(report)}
                </p>
              )}
            </>
          ) : (
            report?.note && (
              <p class="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
                {report.note}
              </p>
            )
          )}
        </div>
      )}
      <div
        id={`runtime-panel-${service.id}`}
        hidden={!open}
        class="border-t border-border bg-muted/10 px-4 py-4 sm:pl-16"
      >
        <p class="text-xs leading-relaxed text-muted-foreground">{ROLE[service.id]}</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{service.message}</p>
        {service.status === "signed-out" && (
          <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Sign in with the CLI itself, using the executable and folder below. Cairngorm does not
            start a login.
          </p>
        )}
        <RuntimeSettings
          service={service}
          busy={busy !== null}
          onSave={onSave}
          onDirtyChange={setDirty}
        />
        {dirty && (
          <p class="mt-2 text-[11px] text-muted-foreground">Save paths before verifying.</p>
        )}
        <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Detection is local and uses no quota. Verifying sends one short request through the CLI.
        </p>
      </div>
    </li>
  );
}
