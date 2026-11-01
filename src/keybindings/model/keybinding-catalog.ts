export const KEYBINDINGS = [
  {
    id: "settings",
    label: "Open settings",
    group: "Navigation",
    context: "global",
    default: "Ctrl+,",
  },
  {
    id: "toggleFiles",
    label: "Show / hide files",
    group: "Navigation",
    context: "app",
    default: "Ctrl+B",
  },
  {
    id: "openGit",
    label: "Show Git",
    group: "Navigation",
    context: "app",
    default: "Ctrl+Shift+G",
  },
  {
    id: "workspace",
    label: "Show workspace",
    group: "Navigation",
    context: "app",
    default: "Ctrl+Alt+1",
  },
  {
    id: "calendar",
    label: "Show calendar",
    group: "Navigation",
    context: "app",
    default: "Ctrl+Alt+2",
  },
  {
    id: "back",
    label: "Go back",
    group: "Navigation",
    context: "navigation",
    default: "Alt+ArrowLeft",
  },
  {
    id: "forward",
    label: "Go forward",
    group: "Navigation",
    context: "navigation",
    default: "Alt+ArrowRight",
  },
  { id: "newFile", label: "New file", group: "Files", context: "app", default: "Ctrl+Alt+N" },
  { id: "openFile", label: "Open file", group: "Files", context: "app", default: "Ctrl+O" },
  {
    id: "openFolder",
    label: "Open folder",
    group: "Files",
    context: "app",
    default: "Ctrl+Shift+O",
  },
  { id: "saveFile", label: "Save file", group: "Files", context: "app", default: "Ctrl+S" },
  { id: "closeTab", label: "Close tab", group: "Workspace", context: "app", default: "Ctrl+W" },
  {
    id: "newTerminal",
    label: "New terminal",
    group: "Workspace",
    context: "app",
    default: "Ctrl+N",
  },
  {
    id: "newTerminalInPane",
    label: "New terminal from a pane",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Shift+T",
  },
  {
    id: "newAgent",
    label: "New Cairngorm agent",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Shift+N",
  },
  {
    id: "nextTab",
    label: "Next tab / pane",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Tab",
  },
  {
    id: "previousTab",
    label: "Previous tab / pane",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Shift+Tab",
  },
  {
    id: "nextProject",
    label: "Next project",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Alt+PageDown",
  },
  {
    id: "previousProject",
    label: "Previous project",
    group: "Workspace",
    context: "workspace",
    default: "Ctrl+Alt+PageUp",
  },
  {
    id: "toggleSplit",
    label: "Split / unsplit vertically",
    group: "Panels",
    context: "app",
    default: "Ctrl+\\",
  },
  {
    id: "splitHorizontal",
    label: "Split horizontally",
    group: "Panels",
    context: "workspace",
    default: "Ctrl+Shift+\\",
  },
  {
    id: "closePane",
    label: "Close active pane",
    group: "Panels",
    context: "workspace",
    default: "Ctrl+Shift+W",
  },
  {
    id: "zoomPane",
    label: "Zoom / restore active pane",
    group: "Panels",
    context: "workspace",
    default: "Ctrl+Shift+Enter",
  },
  {
    id: "fontIncrease",
    label: "Increase terminal & chat font",
    group: "Panels",
    context: "global",
    default: "Ctrl+=",
  },
  {
    id: "fontDecrease",
    label: "Decrease terminal & chat font",
    group: "Panels",
    context: "global",
    default: "Ctrl+-",
  },
  {
    id: "fontReset",
    label: "Reset terminal & chat font",
    group: "Panels",
    context: "global",
    default: "Ctrl+0",
  },
  {
    id: "reattach",
    label: "Reattach to main window",
    group: "Windows",
    context: "detached",
    default: "Ctrl+Shift+A",
  },
] as const;

export type KeybindingId = (typeof KEYBINDINGS)[number]["id"];
export type KeybindingContext = (typeof KEYBINDINGS)[number]["context"];
export const KEYBINDING_CONTEXTS: Record<KeybindingContext, string> = {
  global: "Anywhere outside dialogs and menus",
  app: "Outside terminal input",
  navigation: "Outside terminal and text input",
  workspace: "Workspace visible, including terminal input",
  detached: "Detached window, including terminal input",
};

export function bindingKeys(binding: string): string[] {
  return binding
    .split("+")
    .map(
      (k) =>
        ({ "=": "+", ArrowLeft: "←", ArrowRight: "→", PageUp: "PgUp", PageDown: "PgDn" })[k] ?? k,
    );
}
