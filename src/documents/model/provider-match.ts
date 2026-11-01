// Pure provider selection. The extension is only a routing hint: each provider declares
// what it interprets, and conflicts are resolved by the user, never by registration order.
import type { DocumentFileType, DocumentProviderInfo } from "./provider";

export type ProviderResolution =
  | { kind: "none" }
  | { kind: "choose"; candidates: DocumentProviderInfo[] }
  | { kind: "provider"; provider: DocumentProviderInfo; candidates: DocumentProviderInfo[] };

export function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\.+/, "");
}

export function fileTypeFor(
  provider: DocumentProviderInfo,
  extension: string,
): DocumentFileType | undefined {
  const wanted = normalizeExtension(extension);
  return provider.fileTypes.find((type) => type.extensions.includes(wanted));
}

/** Candidates in a stable order: built-ins first, then installed providers by name. */
export function providersFor(
  providers: DocumentProviderInfo[],
  extension: string,
): DocumentProviderInfo[] {
  if (!normalizeExtension(extension)) {
    return [];
  }
  return providers
    .filter((provider) => fileTypeFor(provider, extension))
    .sort(
      (a, b) =>
        Number(a.source !== "builtin") - Number(b.source !== "builtin") ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

/** Editors that ship with Cairngorm (ids reserved natively for bundled providers). */
export function isIncludedProvider(provider: Pick<DocumentProviderInfo, "id" | "source">) {
  return provider.source === "installed" && provider.id.startsWith("app.cairngorm.");
}

/**
 * An explicit choice for this pane wins, then the remembered choice for the extension, then
 * the editor included with Cairngorm. Otherwise, with several candidates, the user is asked;
 * a stale choice is ignored.
 */
export function resolveProvider(
  candidates: DocumentProviderInfo[],
  options: { explicit?: string; remembered?: string },
): ProviderResolution {
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  const chosen = [options.explicit, options.remembered]
    .map((id) => id && candidates.find((provider) => provider.id === id))
    .find(Boolean);
  if (chosen) {
    return { kind: "provider", provider: chosen, candidates };
  }
  const included = candidates.filter(isIncludedProvider);
  if (candidates.length === 1 || included.length === 1) {
    return { kind: "provider", provider: included[0] ?? candidates[0], candidates };
  }
  return { kind: "choose", candidates };
}

export function mimeTypeFor(provider: DocumentProviderInfo, extension: string): string {
  return fileTypeFor(provider, extension)?.mimeTypes[0] ?? "application/octet-stream";
}
