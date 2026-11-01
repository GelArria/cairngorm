import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/common/ui/card";
import { Icon } from "@/common/ui/icon";
import { SettingsSection } from "@/settings/components/settings-layout";
import { useBundledProviders } from "../hooks/use-bundled-providers";

/**
 * Editors that come with Cairngorm are added automatically; one the user removed is listed
 * here so one click adds it back.
 */
export function BundledProviderList() {
  const { bundled, adding, error, add } = useBundledProviders();
  const removed = bundled?.filter((provider) => !provider.installed) ?? [];
  if (!removed.length) {
    return null;
  }
  return (
    <SettingsSection title="Included with Cairngorm">
      <div class="flex flex-col gap-2">
        {error && (
          <p role="alert" class="text-xs text-destructive">
            {error}
          </p>
        )}
        <ul class="grid gap-2 sm:grid-cols-2" data-testid="bundled-provider-list">
          {removed.map(({ name, manifest, installed }) => (
            <li key={name}>
              <Card class="h-full gap-3 py-3 shadow-none">
                <CardHeader class="grid-cols-[auto_1fr] gap-x-3 px-3">
                  <span class="row-span-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon name="file-sheet" class="text-base" />
                  </span>
                  <CardTitle class="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {manifest.name}
                    {manifest.capabilities.includes("edit") && (
                      <Badge variant="outline">Can edit</Badge>
                    )}
                  </CardTitle>
                  <CardDescription class="leading-relaxed">{manifest.description}</CardDescription>
                </CardHeader>
                <CardFooter class="mt-auto justify-between gap-2 px-3">
                  <span class="text-[11px] text-muted-foreground">
                    {manifest.fileTypes.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(" ")}
                    {manifest.operations?.length ? " · agent actions" : ""}
                  </span>
                  {installed ? (
                    <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Icon name="check" />
                      Added
                    </span>
                  ) : (
                    <Button
                      size="xs"
                      disabled={adding !== null}
                      onClick={() => void add(name)}
                      data-testid={`bundled-provider-add-${name}`}
                    >
                      {adding === name ? "Adding…" : "Add"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}
