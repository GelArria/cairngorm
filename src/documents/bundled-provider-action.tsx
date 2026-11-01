// The catalog's one-click action for an application whose files a bundled provider opens:
// adding it installs that provider and makes it the choice for those files.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { useBundledProviders } from "./hooks/use-bundled-providers";

export function BundledProviderAction({ name, label }: { name: string; label: string }) {
  const { bundled, adding, error, add } = useBundledProviders();
  const entry = bundled?.find((provider) => provider.name === name);
  if (!entry) {
    return null;
  }
  if (entry.installed) {
    return (
      <Tooltip content={`${label} files open in ${entry.manifest.name}`}>
        <span class="flex shrink-0 items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <Icon name="check" />
          Editor
        </span>
      </Tooltip>
    );
  }
  return (
    <div class="flex shrink-0 items-center gap-1">
      {error && (
        <Tooltip content={error}>
          <span role="alert" class="block max-w-40 truncate text-[11px] text-destructive">
            {error}
          </span>
        </Tooltip>
      )}
      <Tooltip
        content={`Open and edit ${label} files inside Cairngorm with ${entry.manifest.name}`}
      >
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Open ${label} files in Cairngorm`}
          disabled={adding !== null}
          onClick={() => void add(name)}
          data-testid={`bundled-provider-action-${name}`}
        >
          <Icon
            name={adding === name ? "spinner" : "plus"}
            class={adding === name ? "motion-safe:animate-spin" : "text-base"}
          />
        </Button>
      </Tooltip>
    </div>
  );
}
