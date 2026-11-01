// Remembered "open with" choices per extension, stored in cairngorm.json
// ("documents": { "openWith": { "xlsx": "app.cairngorm.spreadsheet" } }).
import { getConfig, subscribeConfig, updateConfig } from "@/config";
import { normalizeExtension } from "../model/provider-match";

/** Where the choices lived before cairngorm.json; read once to create the file. */
const LEGACY_KEY = "cairngorm.document-providers.choices.v1";

function read(): Record<string, string> {
  const documents = getConfig().documents as { openWith?: unknown } | undefined;
  const choices = documents?.openWith;
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(choices).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function getProviderChoices(): Record<string, string> {
  return read();
}

export function getProviderChoice(extension: string): string | undefined {
  return read()[normalizeExtension(extension)];
}

export function rememberProviderChoice(extension: string, providerId: string) {
  void updateConfig(["documents", "openWith", normalizeExtension(extension)], providerId).catch(
    (error) => console.error("[documents] cairngorm.json", error),
  );
}

export function forgetProviderChoice(extension: string) {
  void updateConfig(["documents", "openWith", normalizeExtension(extension)], undefined).catch(
    (error) => console.error("[documents] cairngorm.json", error),
  );
}

export function subscribeProviderChoices(listener: () => void) {
  return subscribeConfig(listener);
}

/** The choices saved before cairngorm.json existed, in its layout (for the first file). */
export function legacyDocumentConfig(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length
      ? { documents: { openWith: value } }
      : {};
  } catch {
    return {};
  }
}
