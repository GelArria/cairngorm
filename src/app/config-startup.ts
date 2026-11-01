// Loads cairngorm.json in every window and follows its changes. Only the main window creates
// a missing file: the first time from the settings this machine already had (terminal and
// "open with" choices), afterwards (if the user deleted it) as an empty file.
import { loadConfig, watchConfig, type ConfigData } from "@/config";
import { legacyDocumentConfig } from "@/documents/api";
import { legacyTerminalConfig } from "@/terminal";

const MIGRATED = "cairngorm.config.migrated.v1";

function firstContents(): ConfigData {
  try {
    if (localStorage.getItem(MIGRATED)) return {};
    localStorage.setItem(MIGRATED, "1");
  } catch {
    // Without storage the old settings cannot be read either.
  }
  return { ...legacyTerminalConfig(), ...legacyDocumentConfig() };
}

export function startConfig(main: boolean) {
  const create = main ? firstContents : undefined;
  watchConfig(create);
  loadConfig(create).catch((error) =>
    console.error("[settings] Could not load cairngorm.json", error),
  );
}
