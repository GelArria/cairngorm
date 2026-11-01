// One changed file: checkbox (checked = staged) · name · dir · status letter.
// Click opens its diff; the selected row also shows its last commit.
import { Tooltip } from "@/common/ui/tooltip";
import {
  classify,
  relTime,
  type GitFile,
  type GitFileInfo,
  type GitFileStatus,
} from "../data/git-bridge";

const STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: "text-yellow-500",
  added: "text-green-500",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  untracked: "text-neutral-500",
  conflicted: "text-red-400 font-bold",
};

const LETTER: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "C",
};

interface Props {
  file: GitFile;
  staged: boolean;
  selected: boolean;
  details?: GitFileInfo;
  onToggle: () => void;
  onOpen: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function GitFileRow({
  file,
  staged,
  selected,
  details,
  onToggle,
  onOpen,
  onContextMenu,
}: Props) {
  const status = classify(file.code);
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <div
      data-testid="git-file-row"
      class={`group mx-1.5 flex cursor-pointer items-start gap-2 rounded-md px-2 py-[3px] ${selected ? "bg-accent" : "hover:bg-secondary"}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
      title={`${file.path} — click for diff`}
    >
      <Tooltip content={staged ? "Unstage" : "Stage"} side="bottom">
        <button
          role="checkbox"
          aria-checked={staged}
          aria-label={staged ? "Unstage" : "Stage"}
          class={`mt-0.5 flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            staged
              ? "border-foreground bg-foreground"
              : "border-neutral-600 hover:border-muted-foreground"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {staged && (
            <svg viewBox="0 0 10 10" class="h-[9px] w-[9px] text-background" aria-hidden="true">
              <path
                d="M1.5 5.2 4 7.5 8.5 2.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          )}
        </button>
      </Tooltip>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1.5">
          <span class="min-w-0 shrink truncate text-xs text-foreground">{name}</span>
          <span
            data-git-directory
            class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70"
          >
            {dir}
          </span>
          <span class={`ml-auto font-mono text-[10px] ${STATUS_COLOR[status]}`}>
            {LETTER[status]}
          </span>
        </div>
        {details && (
          // Selected only: hovering must not expand rows and shift the list.
          <div
            class={`mt-0.5 gap-1.5 font-mono text-[10px] text-muted-foreground/70 ${selected ? "flex" : "hidden"}`}
            data-testid="git-file-meta"
          >
            <span class="text-violet-400">{details.hash}</span>
            <span class="truncate">{details.author}</span>
            <span>{relTime(details.at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
