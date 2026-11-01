import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import type { BrokenDocumentProvider, DocumentProviderInfo } from "../model/provider";
import { isIncludedProvider } from "../model/provider-match";

const extensions = (provider: DocumentProviderInfo) =>
  provider.fileTypes.flatMap((type) => type.extensions.map((e) => `.${e}`)).join(" ");

export function ProviderList({
  providers,
  broken = [],
  onRemove,
  empty,
}: {
  providers: DocumentProviderInfo[];
  broken?: BrokenDocumentProvider[];
  onRemove?: (id: string) => void;
  empty?: string;
}) {
  if (providers.length === 0 && broken.length === 0) {
    return <p class="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul
      class="flex flex-col divide-y divide-border rounded-md border border-border"
      data-testid="document-provider-list"
    >
      {providers.map((provider) => (
        <li key={provider.id} class="flex items-center gap-3 px-3 py-2.5">
          <Icon name="file-text" class="shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
              {provider.name}
              <span class="font-normal text-muted-foreground">{provider.version}</span>
              <Badge variant="outline">
                {provider.capabilities.includes("edit") ? "Can edit" : "Read-only"}
              </Badge>
              {isIncludedProvider(provider) && <Badge variant="secondary">Included</Badge>}
            </div>
            <div
              class="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={provider.description}
            >
              {extensions(provider)}
              {provider.source === "installed" &&
                !isIncludedProvider(provider) &&
                ` · ${provider.id}`}
            </div>
          </div>
          {onRemove && provider.source === "installed" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${provider.name}`}
              title={`Remove ${provider.name}`}
              onClick={() => onRemove(provider.id)}
            >
              <Icon name="trash" />
            </Button>
          )}
        </li>
      ))}
      {broken.map((provider) => (
        <li key={provider.id} class="flex items-center gap-3 px-3 py-2.5">
          <Icon name="warning-circle" class="shrink-0 text-destructive" />
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium text-foreground">{provider.id}</div>
            <div role="alert" class="mt-0.5 text-[11px] text-destructive">
              {provider.error}
            </div>
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${provider.id}`}
              onClick={() => onRemove(provider.id)}
            >
              <Icon name="trash" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
