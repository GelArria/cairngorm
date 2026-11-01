// Sidebar icons with motion: Lucide geometry (ISC — same shapes as <Icon>), each
// part tagged so ./animated-icon.css can move it. They play while the closest
// `.group` ancestor is hovered or keyboard-focused (or `play` is set); state
// icons (chevron, plus, star, check) animate their own transitions.
// prefers-reduced-motion → static. Inspired by lucide-animated / animate-ui,
// without `motion` (a React runtime this Preact app doesn't carry).
import { cn } from "@/common/utils";
import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./animated-icon.css";
import { Icon, type IconName } from "./icon";

interface BaseProps {
  class?: string;
  /** keep the animation running (e.g. while a hover target is the row, not the icon's group) */
  play?: boolean;
  strokeWidth?: number;
}

function Svg({
  kind,
  class: className,
  play,
  strokeWidth = 1.75,
  children,
  fill = "none",
  onAnimationEnd,
}: BaseProps & {
  kind: string;
  children: ComponentChildren;
  fill?: string;
  onAnimationEnd?: () => void;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill={fill}
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cn(
        "ai inline-block shrink-0 overflow-visible align-[-0.125em]",
        `ai-${kind}`,
        play && "ai-play",
        className,
      )}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </svg>
  );
}

/** Terminal: the prompt chevron nudges forward, the cursor blinks. */
export const TerminalIcon = (p: BaseProps) => (
  <Svg kind="terminal" {...p}>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <path class="ai-chev" d="m7 11 2-2-2-2" />
    <path class="ai-cursor" d="M11 13h4" />
  </Svg>
);

/** Calendar: binder rings hop, the day dots light up in reading order. */
export const CalendarIcon = (p: BaseProps) => (
  <Svg kind="calendar" {...p}>
    <path class="ai-ring" d="M8 2v3" />
    <path class="ai-ring ai-d2" d="M16 2v3" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    {[
      ["8", "13"],
      ["12", "13"],
      ["16", "13"],
      ["8", "17"],
      ["12", "17"],
      ["16", "17"],
    ].map(([x, y], i) => (
      <path key={i} class={`ai-dot ai-d${i}`} d={`M${x} ${y}h.01`} />
    ))}
  </Svg>
);

/** Files: the front sheet slides off the stack and back. */
export const FilesIcon = (p: BaseProps) => (
  <Svg kind="files" {...p}>
    <path class="ai-back" d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
    <g class="ai-front">
      <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
      <path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
    </g>
  </Svg>
);

/** Git branch: the branch line draws itself out of the commit, the tips pop. */
export const GitBranchIcon = (p: BaseProps) => (
  <Svg kind="git" {...p}>
    <path class="ai-draw" pathLength={1} d="M15 6a9 9 0 0 0-9 9V3" />
    <circle class="ai-node" cx="18" cy="6" r="3" />
    <circle class="ai-node ai-d2" cx="6" cy="18" r="3" />
  </Svg>
);

/** Search: the lens swings like it is scanning. */
export const SearchIcon = (p: BaseProps) => (
  <Svg kind="search" {...p}>
    <g class="ai-lens">
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </g>
  </Svg>
);

/** Plus: a quarter turn on hover. */
export const PlusIcon = (p: BaseProps) => (
  <Svg kind="spin" {...p}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Svg>
);

/** Close: a quarter turn on hover. */
export const XIcon = (p: BaseProps) => (
  <Svg kind="spin" {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

/** Collapse / expand the sidebar: the double chevron runs in its direction. */
export const ChevronsIcon = ({ dir, ...p }: BaseProps & { dir: "left" | "right" }) => (
  <Svg kind={`chevrons-${dir}`} {...p}>
    <g class={dir === "right" ? "ai-mirror" : undefined}>
      <path class="ai-c1" d="m11 17-5-5 5-5" />
      <path class="ai-c2" d="m18 17-5-5 5-5" />
    </g>
  </Svg>
);

/** Disclosure caret: one chevron that turns smoothly between closed and open. */
export const ChevronIcon = ({ open, ...p }: BaseProps & { open: boolean }) => (
  <Svg kind="caret" {...p} class={cn(open && "ai-open", p.class)}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

/** Agent: it blinks and wags its antenna. */
export const BotIcon = (p: BaseProps) => (
  <Svg kind="bot" {...p}>
    <path class="ai-antenna" d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path class="ai-eye" d="M15 13v2" />
    <path class="ai-eye" d="M9 13v2" />
  </Svg>
);

/** Terminal group: the divider slides like the panes are being re-split. */
export const ColumnsIcon = (p: BaseProps) => (
  <Svg kind="columns" {...p}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path class="ai-split" d="M12 3v18" />
  </Svg>
);

/** Rename: the pencil scribbles. */
export const PencilIcon = (p: BaseProps) => (
  <Svg kind="pencil" {...p}>
    <path class="ai-line" pathLength={1} d="M13 21h8" />
    <g class="ai-nib">
      <path d="m15 5 4 4" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </g>
  </Svg>
);

/** Pin: hover wiggles; the moment it gets pinned it pops in solid (once —
 *  not on mount, not again when the pointer leaves). */
export function StarIcon({ filled, ...p }: BaseProps & { filled?: boolean }) {
  const prev = useRef(filled);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (filled && !prev.current) {
      setPop(true);
    }
    prev.current = filled;
  }, [filled]);
  return (
    <Svg
      kind="star"
      {...p}
      fill={filled ? "currentColor" : "none"}
      class={cn(pop && "ai-pop-in", p.class)}
      onAnimationEnd={() => setPop(false)}
    >
      <path d={STAR} />
    </Svg>
  );
}

const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

/** Done: the check writes itself in when it appears. */
export const CheckDrawIcon = (p: BaseProps) => (
  <Svg kind="check" strokeWidth={2.5} {...p}>
    <path class="ai-draw-in" pathLength={1} d="M20 6 9 17l-5-5" />
  </Svg>
);

const ANIMATED: Partial<Record<IconName, FunctionComponent<BaseProps>>> = {
  "terminal-window": TerminalIcon,
  terminal: TerminalIcon,
  calendar: CalendarIcon,
  files: FilesIcon,
  "git-branch": GitBranchIcon,
  "magnifying-glass": SearchIcon,
  plus: PlusIcon,
  x: XIcon,
  robot: BotIcon,
  columns: ColumnsIcon,
  "pencil-simple-line": PencilIcon,
};

/** `name`'s animated variant when there is one, else the static icon — for
 *  name-driven buttons that live in the sidebar (headers, toolbars). */
export function SidebarIcon({ name, ...p }: BaseProps & { name: IconName }) {
  const A = ANIMATED[name];
  return A ? <A {...p} /> : <Icon name={name} class={p.class} strokeWidth={p.strokeWidth} />;
}
