// One project in the Projects grid: its gemstone card — the Cairngorm gem in the
// project's stone colour and cut (turns when selected, hovered or focused)
// over its backdrop — with name, folder and live status.
import type { Project } from "@/projects/api";
import { folderName } from "@/projects/api";
import { gemYaw, ProjectBackdrop, ProjectGem, projectStone } from "@/projects/visuals";
import { useEffect, useRef, useState } from "preact/hooks";
import { ProjectNameInput } from "./project-name-input";
import { StatusGlyph } from "./terminal-status";

interface Props {
  project: Project;
  active: boolean;
  /** Terminals in the project */
  count: number;
  rollup: "running" | "error" | "done" | null;
  onSelect: () => void;
  onRename: () => void;
  renaming: boolean;
  onRenameClose: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

export function ProjectTile({
  project: p,
  active,
  count,
  rollup,
  onSelect,
  onRename,
  renaming,
  onRenameClose,
  onContextMenu,
}: Props) {
  const stone = projectStone(p);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // Keep the selected project visible when the grid scrolls (many projects)
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);
  return (
    <div class="relative min-w-0">
      <button
        ref={ref}
        type="button"
        data-testid={`project-box-${p.id}`}
        data-image-backdrop={p.background?.startsWith("image:") || undefined}
        aria-current={active ? "true" : undefined}
        title={p.rootPath || p.name}
        aria-label={`${p.name}, ${count} ${count === 1 ? "terminal" : "terminals"}${rollup === "running" ? ", running" : rollup === "error" ? ", error" : ""}`}
        class={`project-themed-card gem-card group relative block h-[66px] w-full overflow-hidden rounded-xl border text-left outline-none transition-[opacity,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring ${
          active ? "" : "border-border opacity-75 hover:opacity-100"
        }`}
        style={{
          "--stone": stone.color,
          ...(active
            ? { borderColor: stone.color }
            : hover
              ? { borderColor: `${stone.color}66` }
              : {}),
        }}
        onClick={onSelect}
        onDblClick={onRename}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          if (e.key === "F2") {
            e.preventDefault();
            onRename();
          }
        }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerCancel={() => setHover(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <ProjectBackdrop project={p} />
        {/* The gem sits half out of the card's right edge */}
        <ProjectGem
          color={stone.color}
          cut={p.cut}
          yaw={gemYaw(p.id)}
          size={74}
          spin={active || hover || focused}
          class="absolute -right-4 top-1/2 -translate-y-1/2"
        />
        <span
          aria-hidden="true"
          class="project-card-shade pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/10 to-transparent"
        />
        <span class="project-card-muted absolute left-2 top-1.5 flex items-center gap-1 text-[10px] tabular-nums text-white/70 drop-shadow">
          {rollup && <StatusGlyph state={rollup} />}
          {count}
          <span class="sr-only"> terminals</span>
        </span>
        <span class="absolute bottom-1.5 left-2 right-10 flex min-w-0 flex-col">
          <span
            class={`project-card-text truncate text-[12px] font-semibold leading-tight text-white drop-shadow ${renaming ? "invisible" : ""}`}
          >
            {p.name}
          </span>
          <span class="project-card-muted truncate text-[10px] leading-tight text-white/55">
            {p.rootPath ? folderName(p.rootPath) : "No folder"}
          </span>
        </span>
      </button>
      {renaming && (
        <ProjectNameInput
          project={p}
          onClose={onRenameClose}
          class="absolute bottom-[18px] left-2 right-2"
        />
      )}
    </div>
  );
}

export function AddProjectTile({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="legend-add-projects"
      aria-label="Open"
      class={`group flex w-full items-center justify-center gap-2 border border-dashed border-border text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${compact ? "col-span-2 h-8 rounded-lg" : "h-[66px] rounded-xl"}`}
      onClick={onClick}
    >
      <span class="relative flex h-6 w-6 items-center justify-center">
        <ProjectGem
          color="#d9c4a8"
          yaw={0.6}
          size={26}
          class="opacity-60 transition-opacity group-hover:opacity-100"
        />
        <span class="absolute -bottom-0.5 -right-1 text-[13px] font-semibold leading-none text-primary">
          +
        </span>
      </span>
      Open
    </button>
  );
}
