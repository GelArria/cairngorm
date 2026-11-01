import { APP_OPEN_MODULE, onAppEvent, type SidebarModuleRequest } from "@/common/events/app-events";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { useMediaQuery } from "@/common/hooks/use-media-query";
import { markViewSwitch } from "@/debug/performance/perf-tracker";
import { useGitStatus } from "@/git/hooks/use-git-status";
import { switchProject, useActiveProject } from "@/projects/index";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import { useSidebarSide } from "../../common/layout/sidebar-side";
import { useTerminalBulkClose } from "../../terminal/dialogs";
import { useTerminalGroups } from "../../terminal/workspace";
import type { ModuleId, ProjectModule, SidebarMode } from "../components/project-modules";
import "../sidebar.css";

export interface AppSidebarProps {
  activeMode?: SidebarMode;
  onModeChange?: (mode: SidebarMode) => void;
  explorerOpen?: boolean;
  onToggleExplorer?: () => void;
}

export function useSidebarState({
  activeMode = "chat",
  onModeChange,
  explorerOpen = false,
  onToggleExplorer,
}: AppSidebarProps) {
  // full collapse (persisted): the Resizable shrinks to a rail.
  // The whole sidebar stays MOUNTED (display:none) — unmounting it remounts
  // the embedded file tree + sections on every toggle = hiccup.
  const [desktopCollapsed, setDesktopCollapsed] = useLocalStorage("sidebar-collapsed", false);
  const compact = useMediaQuery("(max-width: 767px)");
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = compact ? !mobileOpen : desktopCollapsed;
  const setCollapsed = (value: boolean) =>
    compact ? setMobileOpen(!value) : setDesktopCollapsed(value);
  useEffect(() => {
    if (!compact) {
      setMobileOpen(false);
    }
  }, [compact]);
  const [gitOpen, setGitOpen] = useLocalStorage("sidebar-git-open", false);
  const git = useGitStatus(); // subscribes; auto-refreshes when workspace root changes
  // Files can open from many places (Ctrl+B, Open file/folder, drops…): whenever
  // it does, Git closes — the two panels never stack, so a module click can't
  // reveal a stale Git panel underneath.
  useEffect(() => {
    if (explorerOpen) {
      setGitOpen(false);
      if (activeMode === "calendar") {
        onModeChange?.("chat");
      }
    }
  }, [explorerOpen, activeMode]);
  const preferredSide = useSidebarSide();
  const side = preferredSide;
  const horizontal = side === "top" || side === "bottom";
  const bgMenu = useContextMenu();
  // Calendar / Files / Git belong to the selected project: an open module
  // replaces its terminal list until toggled off.
  const open: ProjectModule | null = explorerOpen
    ? "files"
    : gitOpen
      ? "git"
      : activeMode === "calendar"
        ? "calendar"
        : null;
  const back = () => {
    if (explorerOpen) {
      onToggleExplorer?.();
    }
    setGitOpen(false);
    if (activeMode !== "chat") {
      markViewSwitch();
      onModeChange?.("chat");
    }
  };
  const closePanel = () => {
    document
      .querySelector<HTMLButtonElement>('[aria-controls="sidebar-dock-panel"][aria-pressed="true"]')
      ?.focus();
    back();
  };
  useLayoutEffect(() => {
    if (!horizontal || !open) {
      return;
    }
    const escape = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        return;
      }
      e.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [horizontal, open, explorerOpen, activeMode]);
  const { openTab, tabs, closeTab } = useTerminalGroups();
  const activeProject = useActiveProject();
  const activeProjectId = activeProject?.id;
  const bulk = useTerminalBulkClose({
    tabs,
    groupId: activeProjectId,
    groupName: activeProject?.name,
    closeTab,
  });
  const newTerminal = (projectId?: string) => {
    if (projectId) {
      switchProject(projectId);
    }
    openTab();
    window.dispatchEvent(new CustomEvent("app-switch-view", { detail: "chat" }));
  };
  // Selecting the same panel again returns to the terminal list.
  const toggleModule = (m: ModuleId) => {
    if (m === "calendar" && m === open) {
      return back();
    }
    // Panels are mutually exclusive; toggling the selected one returns to terminals.
    if (m === open && m === "files") {
      return onToggleExplorer?.();
    }
    if (m === open && m === "git") {
      return setGitOpen(false);
    }
    if (m === "files") {
      onModeChange?.("chat");
      setGitOpen(false);
      if (!explorerOpen) {
        onToggleExplorer?.();
      }
    }
    if (m === "git") {
      onModeChange?.("chat");
      if (explorerOpen) {
        onToggleExplorer?.();
      }
      setGitOpen(true);
    }
    if (m === "calendar") {
      if (explorerOpen) {
        onToggleExplorer?.();
      }
      setGitOpen(false);
      markViewSwitch();
      onModeChange?.("calendar");
    }
  };
  // "Show Files / Git" from the terminal area: expand and open (never toggle shut)
  useEffect(
    () =>
      onAppEvent<SidebarModuleRequest>(APP_OPEN_MODULE, (m) => {
        if (!horizontal) {
          setCollapsed(false);
        }
        if (open !== m) {
          toggleModule(m);
        }
      }),
    [open, explorerOpen, gitOpen, activeMode, compact, horizontal],
  );

  return {
    side,
    horizontal,
    collapsed,
    compact,
    mobileOpen,
    setMobileOpen,
    setCollapsed,
    git,
    gitOpen,
    setGitOpen,
    bgMenu,
    open,
    activeProject,
    activeProjectId,
    closePanel,
    toggleModule,
    newTerminal,
    bulk,
  };
}
