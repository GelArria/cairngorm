import { useEffect, useState } from "preact/hooks";
import {
  connectAiService,
  detectAiServices,
  finishAiSetup,
  saveAiRuntime,
  type AiRuntime,
  type AiService,
  type IntegrationView,
} from "../data/ai-services";

export function useAiIntegrations(open: boolean, onDone?: () => void) {
  const [view, setView] = useState<IntegrationView | null>(null);
  const [busy, setBusy] = useState<string | null>("scan");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const loaded = (v: IntegrationView) => {
    setView(v);
    setCheckedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setBusy("scan");
    setError(null);
    detectAiServices()
      .then((v) => {
        if (!cancelled) {
          loaded(v);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  const scan = async () => {
    setBusy("scan");
    setError(null);
    setNotice(null);
    try {
      loaded(await detectAiServices());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const connect = async (service: AiService, acknowledgement?: string) => {
    setBusy(service.id);
    setError(null);
    setNotice(null);
    try {
      await connectAiService(service.id, acknowledgement);
      setView(
        (v) =>
          v && {
            ...v,
            commitProvider: service.id,
            claudeConsentRequired: false,
            claudeApiConsentGranted: service.id === "claude",
            setupComplete: true,
            services: v.services.map((s) =>
              s.id === service.id
                ? {
                    ...s,
                    message:
                      "Access verified in this session. Ready to generate editable commit messages.",
                  }
                : s,
            ),
          },
      );
      setNotice(
        `${service.name} verified and in use by the Cairngorm agent. Nothing is committed automatically.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const saveRuntime = async (service: AiService, runtime: AiRuntime) => {
    setBusy("runtime");
    setError(null);
    setNotice(null);
    try {
      loaded(await saveAiRuntime(service.id, runtime));
      setNotice(`${service.name} paths saved. Verify access before using this setup for commits.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  /** `close: false` keeps onboarding open (used when consent is withdrawn). */
  const finish = async (useApi: boolean, close = true) => {
    setBusy("save");
    setError(null);
    try {
      await finishAiSetup(useApi);
      if (useApi) {
        setView(
          (v) =>
            v && {
              ...v,
              commitProvider: null,
              claudeApiConsentGranted: false,
              claudeConsentRequired: false,
            },
        );
        setNotice("The Cairngorm agent now uses its model endpoint.");
      }
      if (close) {
        onDone?.();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  return { view, busy, error, notice, checkedAt, scan, connect, saveRuntime, finish };
}
