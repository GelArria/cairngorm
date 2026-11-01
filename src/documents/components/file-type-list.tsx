// Settings ▸ Documents: every file type Cairngorm can open, what opens it, and whether that
// editor can change it and take agent actions. "Open with" changes the default per type.
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { forgetProviderChoice, rememberProviderChoice } from "../data/provider-preferences";
import type { DocumentProviderInfo } from "../model/provider";
import { providersFor, resolveProvider } from "../model/provider-match";

export function FileTypeList({
  providers,
  choices,
}: {
  providers: DocumentProviderInfo[];
  choices: Record<string, string>;
}) {
  const extensions = [
    ...new Set(providers.flatMap((p) => p.fileTypes.flatMap((t) => t.extensions))),
  ].sort();
  return (
    <ul
      class="flex flex-col divide-y divide-border rounded-md border border-border"
      data-testid="document-file-types"
    >
      {extensions.map((extension) => {
        const candidates = providersFor(providers, extension);
        const resolution = resolveProvider(candidates, { remembered: choices[extension] });
        const provider = resolution.kind === "provider" ? resolution.provider : null;
        const edits = provider?.capabilities.includes("edit");
        return (
          <li
            key={extension}
            class="flex items-center gap-3 px-3 py-2"
            data-testid={`file-type-${extension}`}
          >
            <span class="w-14 shrink-0 font-mono text-xs text-foreground">.{extension}</span>
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
              <span class="truncate text-foreground">{provider?.name ?? "Asks which to use"}</span>
              {provider && <Badge variant="outline">{edits ? "Edit" : "View only"}</Badge>}
              {provider?.operations?.length ? (
                <Badge variant="outline">
                  <Icon name="sparkle" class="mr-1" />
                  Agents
                </Badge>
              ) : null}
            </div>
            {candidates.length > 1 && (
              <DropdownMenu
                align="end"
                label={`Open .${extension} with`}
                trigger={
                  <Button variant="ghost" size="xs" class="shrink-0 text-muted-foreground">
                    Open with
                    <Icon name="caret-down" class="ml-1" />
                  </Button>
                }
              >
                <DropdownMenuLabel>Open .{extension} with</DropdownMenuLabel>
                {candidates.map((candidate) => (
                  <DropdownMenuItem
                    key={candidate.id}
                    checked={candidate.id === provider?.id}
                    onClick={() => rememberProviderChoice(extension, candidate.id)}
                  >
                    {candidate.name}
                  </DropdownMenuItem>
                ))}
                {choices[extension] && (
                  <DropdownMenuItem onClick={() => forgetProviderChoice(extension)}>
                    Use the default
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            )}
          </li>
        );
      })}
    </ul>
  );
}
