// A Project is a folder with its own terminals, files, git, calendar and chats
// (the successor of the old in-memory terminal "groups").
export interface Project {
  id: string;
  name: string;
  /** Workspace root: file tree, git and the cwd of new terminals. "" = none. */
  rootPath: string;
  /** Label colour (TAG_COLORS id), unset = none */
  color?: string;
  /** Tile background: "preset:<id>" | "image:<path>" | "none"; unset = app default */
  background?: string;
  /** Gem cut id (see gem-cuts.ts); unset = oval, the brand cut */
  cut?: string;
  createdAt: number;
}

export interface ProjectRecovery {
  projects: Project[];
  activeId?: string;
}

/** Application-owned relations; the project store never imports other features. */
export interface ProjectLifecycle {
  recover?: () => ProjectRecovery | null;
  onFirstProject?: (id: string) => Promise<void>;
  beforeDelete?: (id: string) => Promise<void>;
  onDelete?: (id: string) => void;
}

export function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ||
    path ||
    "Project"
  );
}
