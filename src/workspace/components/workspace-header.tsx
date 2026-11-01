// Files header (Sidebar v2): workspace folder name over "branch · N changes",
// open-folder and search-in-files buttons. Without a folder: add file/folder.
import { SidebarIcon } from "@/common/ui/animated-icon";
import { Button } from "@/common/ui/button";
import { Icon, type IconName } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { cn } from "@/common/utils";

interface Props {
  rootPath: string | null;
  branch: string | null;
  changes: number;
  searchMode: boolean;
  onOpenFolder: () => void;
  onToggleSearch: () => void;
  onCloseFolder: () => void;
  onAddFolder: () => void;
  onAddFile: () => void;
}

function IconBtn({
  tip,
  icon,
  onClick,
  active,
}: {
  tip: string;
  icon: IconName;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip content={tip} side="bottom">
      <Button
        variant="subtle"
        size="icon-sm"
        aria-label={tip}
        aria-pressed={active}
        onClick={onClick}
        class={cn(
          "group",
          active &&
            "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground",
        )}
      >
        <SidebarIcon name={icon} class="text-[13px]" />
      </Button>
    </Tooltip>
  );
}

export function WorkspaceHeader(p: Props) {
  const name = p.rootPath?.split(/[\\/]/).filter(Boolean).pop();
  const meta = [p.branch, p.changes > 0 ? `${p.changes} change${p.changes === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div class="flex min-w-0 shrink-0 items-center gap-2 px-3 pb-2 pt-2">
      <div class="group flex min-w-0 flex-1 flex-col gap-[3px] font-mono">
        {name ? (
          <span class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
            <span class="truncate" data-testid="workspace-name">
              {name}
            </span>
            <Button
              variant="subtle"
              size="icon-xs"
              class="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Close folder"
              title="Close folder"
              onClick={p.onCloseFolder}
            >
              <Icon name="x" />
            </Button>
          </span>
        ) : (
          <span class="text-xs font-semibold text-foreground">No folder</span>
        )}
        {meta && <span class="truncate text-[10px] text-muted-foreground/70">{meta}</span>}
      </div>
      <IconBtn tip="Open folder" icon="folder-open" onClick={p.onOpenFolder} />
      {p.rootPath ? (
        <IconBtn
          tip="Search in files"
          icon="magnifying-glass"
          onClick={p.onToggleSearch}
          active={p.searchMode}
        />
      ) : (
        <>
          <IconBtn tip="New folder" icon="folder-plus" onClick={p.onAddFolder} />
          <IconBtn tip="New file" icon="plus" onClick={p.onAddFile} />
        </>
      )}
    </div>
  );
}
