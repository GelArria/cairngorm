// Settings ▸ Themes & colors ▸ Explorer icons: pick a style, previewed on real names.
import { RadioGroup, RadioGroupItem, RadioIndicator } from "@/common/ui/radio-group";
import { cn } from "@/common/utils";
import { FileTypeIcon } from "@/workspace/components/file-type-icon";
import {
  FILE_ICON_THEMES,
  type FileIconTheme,
  setFileIconTheme,
} from "@/workspace/data/file-icon-theme";
import { useFileIconTheme } from "@/workspace/hooks/use-file-icon-theme";

const SAMPLE = [
  { name: "src", folder: true },
  { name: "app.tsx" },
  { name: "main.rs" },
  { name: "package.json" },
  { name: "README.md" },
  { name: "logo.svg" },
];

export function FileIconSettings() {
  const theme = useFileIconTheme();
  return (
    <section aria-labelledby="file-icon-settings" data-testid="file-icon-settings">
      <h4 id="file-icon-settings" class="text-[13px] font-semibold text-foreground">
        Explorer icons
      </h4>
      <p class="mb-3 mt-0.5 text-[11px] text-muted-foreground">
        Used in the file tree and search results.
      </p>
      <RadioGroup
        value={theme}
        onValueChange={(next) => setFileIconTheme(next as FileIconTheme)}
        aria-labelledby="file-icon-settings"
        class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"
      >
        {FILE_ICON_THEMES.map((option) => {
          const checked = theme === option.id;
          return (
            <RadioGroupItem
              key={option.id}
              value={option.id}
              data-testid={`file-icon-theme-${option.id}`}
              class={cn(
                "flex min-w-0 flex-col gap-2.5 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                checked ? "border-primary bg-accent/50" : "border-border",
              )}
            >
              <span class="flex items-center gap-2">
                <RadioIndicator checked={checked} />
                <span class="text-xs font-medium text-foreground">{option.label}</span>
              </span>
              {/* A fixed grid: icons sit in the same slots on every card. */}
              <span
                aria-hidden="true"
                class="grid h-7 grid-cols-6 place-items-center rounded-md bg-background px-1"
              >
                {SAMPLE.map((file) => (
                  <FileTypeIcon
                    key={file.name}
                    name={file.name}
                    folder={file.folder}
                    theme={option.id}
                    bare
                  />
                ))}
              </span>
              <span class="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>
    </section>
  );
}
