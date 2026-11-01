import {
  PRESETS,
  getAgentConfig,
  presetOf,
  saveAgentConfig,
  testAgentConnection,
  type AgentConfigView,
  type AgentTestResult,
  type ProviderPreset,
} from "@/agent/data/agent-config";
import { useEffect, useState } from "preact/hooks";

export function useAgentSettings({ open }: { open: boolean }) {
  const [saved, setSaved] = useState<AgentConfigView | null>(null);
  const [preset, setPreset] = useState<ProviderPreset>(PRESETS[0]);
  // Kept apart from the preset: a saved "ollama" on a LAN URL shows as Custom
  // but must stay "ollama" unless the user picks another provider
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keyEnv, setKeyEnv] = useState("OPENAI_API_KEY");
  const [key, setKey] = useState(""); // typed key; empty = keep the saved one
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [test, setTest] = useState<AgentTestResult | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (c: AgentConfigView) => {
    setSaved(c);
    setPreset(presetOf(c));
    setProvider(c.provider);
    setModel(c.model);
    setBaseUrl(c.baseUrl);
    setKeyEnv(c.apiKeyEnv);
    setKey("");
    setRemoveKey(false);
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    setTest(null);
    setNotice(null);
    getAgentConfig()
      .then(load)
      .catch(() => setNotice({ ok: false, text: "Could not read the agent config." }));
  }, [open]);

  const pick = (p: ProviderPreset) => {
    setPreset(p);
    setTest(null);
    setNotice(null);
    setProvider(p.provider);
    if (p.id !== "custom") {
      setBaseUrl(p.baseUrl);
      setModel(p.model);
      setKeyEnv(p.apiKeyEnv);
    } else {
      setKeyEnv("OPENAI_API_KEY");
    }
  };
  const dirty =
    !!saved &&
    (provider !== saved.provider ||
      model !== saved.model ||
      baseUrl !== saved.baseUrl ||
      keyEnv !== saved.apiKeyEnv ||
      !!key ||
      removeKey);
  const keyStatus = removeKey
    ? "Will be removed on save"
    : key
      ? "New key — saved on Save"
      : saved?.keySource === "saved"
        ? `Saved · ends in ${saved.keyHint}`
        : saved?.keySource === "env"
          ? `From ${saved.apiKeyEnv} · ends in ${saved.keyHint}`
          : preset.keyOptional
            ? "Not needed for a local server"
            : "Not set";

  const runTest = async () => {
    setBusy("test");
    setNotice(null);
    try {
      setTest(await testAgentConnection(baseUrl, keyEnv, key, !removeKey, provider));
    } catch (e) {
      setTest({ ok: false, message: String(e), models: [] });
    }
    setBusy(null);
  };
  const save = async () => {
    setBusy("save");
    setNotice(null);
    try {
      load(
        await saveAgentConfig({
          provider,
          model,
          baseUrl,
          apiKeyEnv: keyEnv,
          apiKey: removeKey ? "" : key || undefined,
          keyOptional: !!preset.keyOptional,
        }),
      );
      setNotice({ ok: true, text: "Saved. New agent sessions use it." });
    } catch (e) {
      setNotice({ ok: false, text: String(e) });
    }
    setBusy(null);
  };
  return {
    saved,
    preset,
    model,
    setModel,
    baseUrl,
    setBaseUrl,
    keyEnv,
    setKeyEnv,
    key,
    setKey,
    removeKey,
    setRemoveKey,
    busy,
    test,
    notice,
    pick,
    dirty,
    keyStatus,
    runTest,
    save,
  };
}
