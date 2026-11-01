// Providers shipped with Cairngorm: one click installs them through the normal approval path
// and makes them the choice for the file types they declare.
import { invoke } from "@tauri-apps/api/core";
import type { DocumentProviderInfo } from "../model/provider";
import { rememberProviderChoice } from "./provider-preferences";
import { reloadProviders } from "./provider-registry";

export interface BundledProvider {
  name: string;
  manifest: Omit<DocumentProviderInfo, "source">;
  installed: boolean;
}

export function listBundledProviders() {
  return invoke<BundledProvider[]>("document_providers_bundled");
}

/** Installs and, since the user asked for it, opens its file types with it from now on. */
export async function installBundledProvider(name: string) {
  const manifest = await invoke<Omit<DocumentProviderInfo, "source">>(
    "document_provider_install_bundled",
    { name },
  );
  for (const type of manifest.fileTypes) {
    for (const extension of type.extensions) {
      rememberProviderChoice(extension, manifest.id);
    }
  }
  await reloadProviders();
  return manifest;
}
