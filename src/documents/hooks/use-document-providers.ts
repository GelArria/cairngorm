import { useEffect, useState } from "preact/hooks";
import {
  getProviderChoice,
  getProviderChoices,
  subscribeProviderChoices,
} from "../data/provider-preferences";
import {
  getProviderRegistry,
  loadProviders,
  subscribeProviderRegistry,
} from "../data/provider-registry";

export function useDocumentProviders() {
  const [registry, setRegistry] = useState(getProviderRegistry);
  useEffect(() => {
    const stop = subscribeProviderRegistry(() => setRegistry(getProviderRegistry()));
    void loadProviders();
    setRegistry(getProviderRegistry());
    return stop;
  }, []);
  return registry;
}

export function useProviderChoice(extension: string) {
  const [choice, setChoice] = useState(() => getProviderChoice(extension));
  useEffect(() => {
    setChoice(getProviderChoice(extension));
    return subscribeProviderChoices(() => setChoice(getProviderChoice(extension)));
  }, [extension]);
  return choice;
}

export function useProviderChoices() {
  const [choices, setChoices] = useState(getProviderChoices);
  useEffect(() => subscribeProviderChoices(() => setChoices(getProviderChoices())), []);
  return choices;
}
