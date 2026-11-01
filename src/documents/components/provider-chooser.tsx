import { Button } from "@/common/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/common/ui/empty";
import { Icon } from "@/common/ui/icon";
import { RadioGroup, RadioGroupItem, RadioIndicator } from "@/common/ui/radio-group";
import { Toggle } from "@/common/ui/toggle";
import { useState } from "preact/hooks";
import type { DocumentProviderInfo } from "../model/provider";

/** Asked the first time several providers can open the same kind of file. */
export function ProviderChooser({
  extension,
  candidates,
  onChoose,
}: {
  extension: string;
  candidates: DocumentProviderInfo[];
  onChoose: (providerId: string, remember: boolean) => void;
}) {
  const [selected, setSelected] = useState(candidates[0]?.id ?? "");
  const [remember, setRemember] = useState(true);
  return (
    <Empty data-testid="document-provider-chooser" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name="plug" />
        </EmptyMedia>
        <EmptyTitle>Choose how to open .{extension} files</EmptyTitle>
        <EmptyDescription>Several installed providers can show this file.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent class="w-full max-w-sm">
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          aria-label="Document provider"
          class="flex w-full flex-col gap-1.5"
        >
          {candidates.map((provider) => (
            <RadioGroupItem
              key={provider.id}
              value={provider.id}
              class="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-checked:border-primary/60"
            >
              <span class="pt-0.5">
                <RadioIndicator checked={provider.id === selected} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-foreground">{provider.name}</span>
                <span class="block text-[11px] text-muted-foreground">
                  {provider.source === "builtin" ? "Built in" : `Installed · ${provider.id}`}
                </span>
              </span>
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <label class="flex w-full items-center justify-between gap-3 text-xs text-muted-foreground">
          Always use this for .{extension} files
          <Toggle
            checked={remember}
            onCheckedChange={setRemember}
            aria-label={`Remember for .${extension} files`}
          />
        </label>
        <Button
          size="sm"
          disabled={!selected}
          onClick={() => onChoose(selected, remember)}
          data-testid="document-provider-open"
        >
          Open
        </Button>
      </EmptyContent>
    </Empty>
  );
}
