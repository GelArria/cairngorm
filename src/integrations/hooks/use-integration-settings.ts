import type { AiService } from "@/integrations/data/ai-services";
import { useAiIntegrations } from "@/integrations/hooks/use-ai-integrations";
import { useAiUsage } from "@/integrations/hooks/use-ai-usage";
import { useSubscriptionConsent } from "@/integrations/hooks/use-subscription-consent";
import { useShowRemaining } from "@/integrations/hooks/use-usage-display";
import { useEffect, useRef, useState } from "preact/hooks";

export function useIntegrationSettings({ open, onDone }: { open: boolean; onDone?: () => void }) {
  const ai = useAiIntegrations(open, onDone);
  const usage = useAiUsage();
  const remaining = useShowRemaining();
  const { consent, geminiConsent, decide } = useSubscriptionConsent();
  const [asking, setAsking] = useState(false);
  const [claudeAsking, setClaudeAsking] = useState(false);
  // Verify waits behind the consent question when it has not been allowed yet.
  const [pendingVerify, setPendingVerify] = useState<AiService | null>(null);
  const services = ai.view?.services ?? [];
  // Subscription CLIs Cairngorm may run once allowed; Claude has its own API consent.
  const detected = services.filter((s) => s.id !== "claude" && s.status === "session-detected");
  const claude = services.find((s) => s.id === "claude");
  // The dialog lists every detected CLI, so it shows Gemini's warning whenever it is asked.
  const geminiDetected = detected.some((s) => s.id === "gemini");
  const mayUse = (id: AiService["id"]) =>
    consent === "granted" && (id !== "gemini" || geminiConsent === "granted");
  useEffect(() => {
    if (open && claude?.cliPath && !ai.view?.claudeApiConsentGranted) {
      setAsking(false);
      setClaudeAsking(true);
    }
  }, [open, claude?.cliPath, ai.view?.claudeApiConsentGranted]);
  const selected = services.find((s) => s.id === ai.view?.commitProvider) ?? null;
  useEffect(() => {
    if (open && (consent === null || (geminiDetected && geminiConsent === null))) {
      if (detected.length > 0) {
        setAsking(true);
      }
    }
  }, [open, consent, geminiConsent, geminiDetected, detected.length]);
  // Declining also withdraws a subscription that is already in use, so "not allowed"
  // never coexists with one powering the agent. Tried once per selection.
  const withdrawn = useRef<string | null>(null);
  useEffect(() => {
    if (
      selected &&
      selected.id !== "claude" &&
      (consent === "declined" || (selected.id === "gemini" && geminiConsent === "declined")) &&
      ai.busy === null &&
      withdrawn.current !== selected.id
    ) {
      withdrawn.current = selected.id;
      void ai.finish(true, false);
    }
  }, [consent, geminiConsent, selected?.id, ai.busy]);
  const verify = (service: AiService) => {
    if (service.id === "claude") {
      if (ai.view?.claudeApiConsentGranted) {
        void ai.connect(service);
      } else {
        setAsking(false);
        setClaudeAsking(true);
      }
      return;
    }
    if (mayUse(service.id)) {
      void ai.connect(service);
    } else {
      setPendingVerify(service);
      setAsking(true);
    }
  };
  const answer = (allowed: boolean) => {
    decide(allowed ? "granted" : "declined", geminiDetected || pendingVerify?.id === "gemini");
    setAsking(false);
    if (allowed && pendingVerify) {
      void ai.connect(pendingVerify);
    }
    setPendingVerify(null);
  };
  const confirmClaude = (acknowledgement: string) => {
    setClaudeAsking(false);
    if (claude) {
      void ai.connect(claude, acknowledgement);
    }
  };
  return {
    ai,
    usage,
    remaining,
    consent,
    asking: asking && !claudeAsking,
    services,
    detected,
    selected,
    verify,
    answer,
    claudeAsking,
    canVerifyClaude: claude?.status === "session-detected",
    confirmClaude,
    closeClaude: () => setClaudeAsking(false),
  };
}
