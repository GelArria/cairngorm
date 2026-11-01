// A file or folder icon in the explorer's chosen style (Settings ▸ Themes & colors).
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import { useFileIconTheme } from "@/workspace/hooks/use-file-icon-theme";
import { type FileIconTheme } from "../data/file-icon-theme";
import { fileIcon, fileIconColor } from "../model/file-icon";
import { fileBadge, materialIcon } from "../model/file-icon-packs";

const FOLDER_TINT = "text-amber-700 dark:text-amber-300";

export function FileTypeIcon({
  name,
  folder = false,
  open = false,
  theme: forced,
  bare = false,
  class: className,
}: {
  name: string;
  folder?: boolean;
  open?: boolean;
  /** Shows a specific style (the Settings preview) instead of the chosen one. */
  theme?: FileIconTheme;
  /** No fixed badge slot: the caller already lays icons out in cells. */
  bare?: boolean;
  class?: string;
}) {
  const chosen = useFileIconTheme();
  const theme = forced ?? chosen;
  const glyph = <Glyph name={name} folder={folder} open={open} theme={theme} class={className} />;
  // Badges vary in width: a fixed slot keeps every file name on the same column.
  return theme === "badges" && !bare ? (
    <span class="inline-flex w-[26px] shrink-0 justify-center">{glyph}</span>
  ) : (
    glyph
  );
}

function Glyph({
  name,
  folder,
  open,
  theme,
  class: className,
}: {
  name: string;
  folder: boolean;
  open: boolean;
  theme: FileIconTheme;
  class?: string;
}) {
  if (theme === "material") {
    return (
      <img
        src={materialIcon(name, folder, open)}
        alt=""
        aria-hidden="true"
        width={16}
        height={16}
        draggable={false}
        class={cn("size-4 shrink-0", className)}
      />
    );
  }
  if (folder) {
    const tint = theme === "colored" || theme === "badges" ? FOLDER_TINT : "text-muted-foreground";
    return (
      <Icon
        name={open ? "folder-open" : "folder"}
        class={cn("shrink-0 text-sm", tint, className)}
      />
    );
  }
  if (theme === "badges") {
    const badge = fileBadge(name);
    if (badge) {
      const [label, color] = badge;
      return (
        <span
          aria-hidden="true"
          class={cn(
            "inline-flex h-3.5 min-w-4 shrink-0 items-center justify-center rounded-[3px] px-[3px] font-mono text-[9px] font-bold leading-none tracking-tight",
            className,
          )}
          style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          {label}
        </span>
      );
    }
  }
  const name_ = theme === "minimal" ? "file" : fileIcon(name);
  const tint =
    theme === "colored" || theme === "badges" ? fileIconColor(name) : "text-muted-foreground";
  return <Icon name={name_} class={cn("shrink-0 text-sm", tint, className)} />;
}
