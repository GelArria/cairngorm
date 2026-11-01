// Focused entry points for features that open files. Callers ask whether any provider
// handles an extension; they never name a provider, format or vendor.
import { getProviderChoice } from "./data/provider-preferences";
import { findDocumentProviders } from "./data/provider-registry";
import type { DocumentOperation } from "./model/provider";
import { resolveProvider } from "./model/provider-match";

export {
  findDocumentProviders,
  hasLoadedDocumentProvider,
  loadProviders as loadDocumentProviders,
} from "./data/provider-registry";
export { HOST_MAX_BYTES as DOCUMENT_MAX_BYTES } from "./model/provider";
export { legacyDocumentConfig } from "./data/provider-preferences";
export type { DocumentOperation } from "./model/provider";
export { readTicket as readAgentSnapshot } from "./data/document-snapshot";
export { requestDocumentSave } from "./data/document-save";
export {
  answerAgentOperation,
  runDocumentOperation,
  samePath,
  type OperationRequest,
} from "./data/open-documents";
export {
  DOCUMENT_REATTACH,
  DOCUMENT_WINDOW_DIRTY,
  DOCUMENT_WINDOW_OPERATION,
  DOCUMENT_WINDOW_READY,
  DOCUMENT_WINDOW_PREFIX,
  focusDocumentWindow,
  openDocumentWindow,
  type DocumentWindowPayload,
} from "./data/document-window";

export async function hasDocumentProvider(extension: string): Promise<boolean> {
  return (await findDocumentProviders(extension)).length > 0;
}

/**
 * Operations of the provider that will show this extension. Empty when the user still has
 * to choose between providers, or the provider declares none.
 */
export async function operationsForExtension(extension: string): Promise<DocumentOperation[]> {
  const candidates = await findDocumentProviders(extension);
  const resolution = resolveProvider(candidates, { remembered: getProviderChoice(extension) });
  return resolution.kind === "provider" ? (resolution.provider.operations ?? []) : [];
}
