import { useState } from "preact/hooks";

const KEY = "cairngorm.subscriptionConsent";
/** Gemini CLI carries its own account warning, so an earlier answer never covers it. */
const GEMINI_KEY = "cairngorm.geminiSubscriptionConsent";

export type Consent = "granted" | "declined" | null;

function readConsent(key: string): Consent {
  try {
    const value = localStorage.getItem(key);
    return value === "granted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function saveConsent(key: string, value: "granted" | "declined") {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Unavailable storage: the answer holds until the app restarts.
  }
}

export function useSubscriptionConsent() {
  const [consent, setConsent] = useState<Consent>(() => readConsent(KEY));
  const [geminiConsent, setGeminiConsent] = useState<Consent>(() => readConsent(GEMINI_KEY));
  /** `gemini` is true when the dialog listed Gemini CLI with its account warning. */
  const decide = (value: "granted" | "declined", gemini = false) => {
    saveConsent(KEY, value);
    setConsent(value);
    if (gemini) {
      saveConsent(GEMINI_KEY, value);
      setGeminiConsent(value);
    }
  };
  return { consent, geminiConsent, decide };
}
