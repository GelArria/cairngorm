// The selected project's panels — Calendar, Files, Git — as one icon-only
// segmented control (names in tooltips); no selection shows its terminals.
// the lit segment is a pill in the project's stone colour that slides between them.
import { preloadView } from "@/app/lazy-views";
import { useProjectAccent } from "@/appearance/model/project-accent";
import { CalendarIcon, FilesIcon, GitBranchIcon } from "@/common/ui/animated-icon";
import { Tooltip } from "@/common/ui/tooltip";
import type { KeybindingId } from "@/keybindings/data/keybindings";
import type { FunctionComponent } from "preact";

/** Sidebar calendar selection; the terminal grid stays visible in either mode. */
export type SidebarMode = "chat" | "calendar";
export type ProjectModule = "calendar" | "files" | "git";
export type ModuleId = ProjectModule;

export const MODULES: {
  id: ModuleId;
  label: string;
  icon: FunctionComponent<{ class?: string }>;
  testId: string;
  shortcut: KeybindingId;
}[] = [
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarIcon,
    testId: "mode-calendar",
    shortcut: "calendar",
  },
  {
    id: "files",
    label: "Files",
    icon: FilesIcon,
    testId: "sidebar-files-toggle",
    shortcut: "toggleFiles",
  },
  {
    id: "git",
    label: "Git",
    icon: GitBranchIcon,
    testId: "sidebar-git-toggle",
    shortcut: "openGit",
  },
];

interface Props {
  open: ProjectModule | null;
  /** Changed files in the working tree (0 = clean / no repo). */
  gitChanges: number;
  /** Project stone colour (lit pill) */
  accent: string;
  onToggle: (m: ModuleId) => void;
  dockSide?: "top" | "bottom";
}

export function ProjectModules({ open, gitChanges, accent, onToggle, dockSide }: Props) {
  const uiAccent = useProjectAccent(accent);
  const slot = MODULES.findIndex((m) => m.id === open);
  return (
    <div
      class={`relative grid grid-cols-3 rounded-[10px] border border-border bg-background p-1 [&>div]:w-full ${dockSide ? "w-[128px] shrink-0" : ""}`}
      role="group"
      aria-label="Project modules"
    >
      <span
        aria-hidden="true"
        hidden={slot < 0}
        class="pointer-events-none absolute bottom-1 left-1 top-1 w-[calc((100%-8px)/3)] rounded-md transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{
          transform: `translateX(${Math.max(0, slot) * 100}%)`,
          background: `${accent}1f`,
          boxShadow: `inset 0 0 0 1px ${accent}4d`,
        }}
      />
      {MODULES.map(({ id, label, icon: I, testId, shortcut }, i) => {
        const on = i === slot;
        const changes = id === "git" && gitChanges > 0 ? gitChanges : 0;
        return (
          <Tooltip
            key={id}
            content={changes ? `${label} · ${changes} changed` : label}
            shortcut={shortcut}
            side={dockSide === "bottom" ? "top" : "bottom"}
            class="flex"
          >
            <button
              type="button"
              data-testid={testId}
              aria-pressed={on}
              aria-controls={dockSide ? "sidebar-dock-panel" : undefined}
              aria-label={changes ? `${label}, ${changes} changed` : label}
              class={`group relative z-10 flex h-8 w-full items-center justify-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
                on ? "" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              style={on ? { color: uiAccent } : undefined}
              onClick={() => onToggle(id)}
              onMouseEnter={id === "calendar" ? () => preloadView("calendar") : undefined}
            >
              <I class="text-[16px] transition-transform duration-200 group-hover:-translate-y-px" />
              {/* A dot, not a number: the sidebar footer already shows the count. */}
              {changes > 0 && (
                <span
                  aria-hidden="true"
                  data-testid="git-changes-dot"
                  class="absolute right-[calc(50%-13px)] top-[7px] size-[5px] rounded-full"
                  style={{ background: accent }}
                />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
