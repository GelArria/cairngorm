// The provider registry: built-ins plus approved installed providers, loaded at runtime from
// native storage. Consumers ask for providers by extension; no consumer names a provider.
import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { BUILTIN_PROVIDERS } from "../builtin/info";
import type {
  BrokenDocumentProvider,
  DocumentProviderInfo,
  InstalledProviderRow,
} from "../model/provider";
import { providersFor } from "../model/provider-match";

export interface ProviderRegistrySnapshot {
  providers: DocumentProviderInfo[];
  broken: BrokenDocumentProvider[];
  loaded: boolean;
  error?: string;
}

let snapshot: ProviderRegistrySnapshot = {
  providers: BUILTIN_PROVIDERS,
  broken: [],
  loaded: false,
};
let loading: Promise<void> | null = null;
let watching = false;
const listeners = new Set<() => void>();

function publish(next: ProviderRegistrySnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export const getProviderRegistry = () => snapshot;

export function subscribeProviderRegistry(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function fetchInstalled() {
  try {
    const rows = await invoke<InstalledProviderRow[]>("document_providers_list");
    const installed = rows.flatMap((row) =>
      row.manifest ? [{ ...row.manifest, source: "installed" as const }] : [],
    );
    const broken = rows.flatMap((row) =>
      row.manifest ? [] : [{ id: row.id, error: row.error ?? "This provider cannot be loaded." }],
    );
    publish({ providers: [...BUILTIN_PROVIDERS, ...installed], broken, loaded: true });
  } catch (error) {
    // Built-ins keep working when the native list is unavailable (for example in a browser).
    publish({ providers: BUILTIN_PROVIDERS, broken: [], loaded: true, error: errorMessage(error) });
  }
}

function watchChanges() {
  if (watching) {
    return;
  }
  watching = true;
  import("@tauri-apps/api/event")
    .then(({ listen }) => listen("document-providers-changed", () => void reloadProviders()))
    .catch(() => {
      /* outside Tauri there are no installed providers to watch */
    });
}

/** Loads once; later callers share the same request. */
export function loadProviders(): Promise<void> {
  watchChanges();
  loading ??= fetchInstalled();
  return loading;
}

export function reloadProviders(): Promise<void> {
  loading = fetchInstalled();
  return loading;
}

export async function findDocumentProviders(extension: string): Promise<DocumentProviderInfo[]> {
  await loadProviders();
  return providersFor(snapshot.providers, extension);
}

/** Uses what is already loaded (built-ins at least); for restoring persisted panes. */
export function hasLoadedDocumentProvider(extension: string): boolean {
  return providersFor(snapshot.providers, extension).length > 0;
}
