import { useIsolatedView } from "../hooks/use-isolated-view";
import type { DocumentViewProps } from "../model/provider";

// Scripts run on the provider's own origin; same-origin applies to that origin only.
// No forms, popups, downloads, top navigation or device permissions.
const SANDBOX = "allow-scripts allow-same-origin";

export function IsolatedDocumentView({
  providerId,
  providerName,
  scope,
  ...view
}: DocumentViewProps & { providerId: string; providerName: string; scope: string }) {
  const { container, frame, loadError } = useIsolatedView({ providerId, scope, ...view });
  if (loadError) {
    return (
      <p role="alert" class="p-4 text-xs text-destructive">
        Could not start {providerName}: {loadError}
      </p>
    );
  }
  return (
    <div ref={container} class="relative h-full min-h-0 w-full">
      <iframe
        ref={frame}
        title={`${providerName}: ${view.title}`}
        data-testid="document-provider-frame"
        class="absolute inset-0 h-full w-full border-0"
        style={{ colorScheme: "normal" }}
        sandbox={SANDBOX}
        referrerpolicy="no-referrer"
      />
    </div>
  );
}
