// The app menu's structure: File, View, Go and Help, like a desktop app's menu bar.
// Items either run a registered command (the same action as its shortcut, disabled
// when nothing offers it right now) or a direct action owned by the header.
import { requestNewProject } from "@/common/events/app-events";
import type { IconName } from "@/common/ui/icon";
import type { KeybindingId } from "@/keybindings/data/keybindings";
import { FONT_SIZE_RANGE, getFontSize, setFontSize } from "@/terminal/data/font-zoom";

export interface MenuCommand {
  icon: IconName;
  label: string;
  /** Registered command to run; also the shortcut shown. */
  command?: KeybindingId;
  /** Direct action (always available); `keybind` names its shortcut. */
  action?: () => void;
  keybind?: KeybindingId;
}

export type MenuEntry = MenuCommand | "separator";

export interface MenuGroup {
  label: string;
  icon: IconName;
  items: MenuEntry[];
}

export interface AppMenuActions {
  onNewFile: () => void;
  onSave: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSettings: (page?: string) => void;
  onCheckUpdates: () => void;
}

export function buildMenuSections(a: AppMenuActions): MenuGroup[] {
  return [
    {
      label: "File",
      icon: "file",
      items: [
        { icon: "terminal", label: "New Terminal", command: "newTerminal" },
        { icon: "robot", label: "New Cairngorm Agent", command: "newAgent" },
        { icon: "folder-plus", label: "New Project…", action: requestNewProject },
        "separator",
        { icon: "file-plus", label: "New File", action: a.onNewFile, keybind: "newFile" },
        { icon: "file", label: "Open File…", action: a.onOpenFile, keybind: "openFile" },
        {
          icon: "folder-open",
          label: "Open Folder…",
          action: a.onOpenFolder,
          keybind: "openFolder",
        },
        { icon: "floppy-disk", label: "Save", action: a.onSave, keybind: "saveFile" },
        "separator",
        { icon: "x", label: "Close Tab", command: "closeTab" },
        "separator",
        { icon: "gear-six", label: "Settings…", action: () => a.onSettings(), keybind: "settings" },
      ],
    },
    {
      label: "View",
      icon: "layout",
      items: [
        { icon: "columns", label: "Workspace", command: "workspace" },
        { icon: "calendar", label: "Calendar", command: "calendar" },
        { icon: "files", label: "Files", command: "toggleFiles" },
        { icon: "git-branch", label: "Git", command: "openGit" },
        "separator",
        { icon: "split-vertical", label: "Split Pane", command: "toggleSplit" },
        { icon: "split-horizontal", label: "Split Down", command: "splitHorizontal" },
        { icon: "corners-out", label: "Zoom Pane", command: "zoomPane" },
        { icon: "square", label: "Close Pane", command: "closePane" },
        "separator",
        {
          icon: "plus",
          label: "Larger Text",
          action: () => setFontSize(getFontSize() + 1),
          keybind: "fontIncrease",
        },
        {
          icon: "minus",
          label: "Smaller Text",
          action: () => setFontSize(getFontSize() - 1),
          keybind: "fontDecrease",
        },
        {
          icon: "arrow-clockwise",
          label: "Reset Text Size",
          action: () => setFontSize(FONT_SIZE_RANGE.base),
          keybind: "fontReset",
        },
      ],
    },
    {
      label: "Go",
      icon: "arrow-u-up-right",
      items: [
        { icon: "caret-left", label: "Back", command: "back" },
        { icon: "caret-right", label: "Forward", command: "forward" },
        "separator",
        { icon: "caret-double-right", label: "Next Tab", command: "nextTab" },
        { icon: "caret-double-left", label: "Previous Tab", command: "previousTab" },
        "separator",
        { icon: "caret-down", label: "Next Project", command: "nextProject" },
        { icon: "caret-up", label: "Previous Project", command: "previousProject" },
      ],
    },
    {
      label: "Help",
      icon: "question",
      items: [
        { icon: "list", label: "Keyboard Shortcuts", action: () => a.onSettings("keybindings") },
        { icon: "arrows-clockwise", label: "Check for Updates…", action: a.onCheckUpdates },
        "separator",
        { icon: "star", label: "About Cairngorm", action: () => a.onSettings("general") },
      ],
    },
  ];
}
