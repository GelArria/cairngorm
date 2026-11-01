import { invoke } from "@tauri-apps/api/core";

export interface AiRuntime {
  binaryPath: string;
  homePath: string;
}

export interface AiService {
  id: "codex" | "claude" | "gemini";
  name: string;
  cliPath: string | null;
  homePath: string;
  runtime: AiRuntime;
  localSetup: boolean;
  status: "session-detected" | "signed-out" | "not-installed" | "check-failed" | "api-key-required";
  authKind: "subscription" | "api-or-custom" | null;
  message: string;
  /** A detected CLI login, for display only; `status` decides whether Cairngorm may use it. */
  login: { plan: string | null; subscription: boolean } | null;
}
export interface IntegrationView {
  setupComplete: boolean;
  commitProvider: string | null;
  services: AiService[];
  claudeConsentRequired?: boolean;
  claudeApiConsentGranted?: boolean;
}

export const needsAiSetup = () => invoke<boolean>("needs_ai_setup");
export const detectAiServices = () => invoke<IntegrationView>("detect_ai_services");
export const connectAiService = (id: AiService["id"], acknowledgement?: string) =>
  invoke<void>(
    "connect_ai_service",
    acknowledgement === undefined ? { id } : { id, acknowledgement },
  );
export const saveAiRuntime = (id: AiService["id"], runtime: AiRuntime) =>
  invoke<IntegrationView>("save_ai_runtime", { id, runtime });
export const finishAiSetup = (useApi = false) => invoke<void>("finish_ai_setup", { useApi });
