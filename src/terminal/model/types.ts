export interface DetectedShell {
  name: string;
  path: string;
  args: string[];
  env: Record<string, string>;
  isDefault: boolean;
}

export interface TermTab {
  id: string;
  title: string;
  profile: string;
  shellPath?: string;
  shellArgs?: string[];
  shellEnv?: Record<string, string>;
  /** Working directory for the shell (default: home). */
  cwd?: string;
  status: "running" | "idle" | "error" | "reconnecting";
  sessionId: string;
  /** First opened time; preserved through splits' own creation, detach and restore. */
  openedAt?: number;
  detached: boolean;
  /** Tests observer retained without occupying a visible tab or layout cell. */
  hidden?: boolean;
  detachedWindowLabel?: string;
  /** Project it belongs to (TermGroup id = Project id). */
  groupId?: string;
  /** When true, PTY stdout is parsed as agent JSONL and emits `agent-event`. */
  isAgent?: boolean;
  /** File tab (no PTY): rendered as a CodeEditor/ImageViewer pane in the same grid. */
  kind?: "file" | "tests" | "plugin" | "app";
  /** Testing panes observe a source terminal; they never own a PTY. */
  testSessionId?: string;
  testSourceTabId?: string;
  /** Plugin panes show the latest MCP App view a source terminal's agent opened. */
  pluginId?: string;
  pluginCallId?: string;
  pluginSourceTabId?: string;
  /** Application panes show an installed application's own window over the pane. */
  appId?: string;
  appName?: string;
  appHwnd?: string;
  appSourceTabId?: string;
  path?: string[];
  fullPath?: string;
  content?: string;
  extension?: string;
  isDirty?: boolean;
  isImage?: boolean;
  imageSrc?: string;
  /** Supplied document content (drop/paste) when there is no file on disk. */
  binarySrc?: string;
  /** Shown by a document provider instead of the code editor; persisted without content. */
  document?: { providerId?: string };
  /** Agent-opened immutable snapshot ticket; not persisted (the file path is reread instead). */
  documentTicket?: string;
  highlightLine?: number;
  highlightText?: string;
  highlightKey?: number;
}

/** The terminal view of a Project (same id): one grid per project. */
export interface TermGroup {
  id: string;
  name: string;
  /** Label colour (TAG_COLORS id), unset = none */
  color?: string;
  /** Project folder — default cwd of new terminals. */
  cwd?: string;
}

export interface TileCell {
  id: string;
  tabId: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface TileLayout {
  cells: TileCell[];
  columnCount: number;
  columnRatios: number[];
  /** Missing in older workspaces: rows default to equal heights. */
  rowRatios?: number[];
  /** Split group label colour (TAG_COLORS id); assigned automatically, user-editable. */
  color?: string;
}

export interface TerminalState {
  tabs: TermTab[];
  layout: TileLayout | null;
  activeTabId: string | null;
  /** One group per project (only the active one is in the grid). */
  groups: TermGroup[];
  activeGroupId: string;
  /** Saved layouts of INACTIVE groups (restored on switch). */
  savedLayouts: Record<string, TileLayout | null>;
  /** Split groups that are not on screen (any project). Selecting one of their
   *  tabs brings the whole group back; tabs in no group show alone. */
  parkedLayouts?: TileLayout[];
  /** Last geometry/focus reported by detached windows, recovered into main. */
  detachedLayouts?: Record<
    string,
    { groupId: string; layout: TileLayout | null; activeTabId: string | null }
  >;
}

/** Named launch settings; defaults open an ordinary terminal in the active group. */
export interface OpenTabOptions {
  profile?: string;
  title?: string;
  shellPath?: string;
  shellArgs?: string[];
  shellEnv?: Record<string, string>;
  isAgent?: boolean;
  sessionId?: string;
  cwd?: string;
}
