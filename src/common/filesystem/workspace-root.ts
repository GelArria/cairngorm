let rootPath: string | null = null;

/** Shared folder context for search and Git; owned by app/project-sync. */
export function getWorkspaceRootPath(): string | null {
  return rootPath;
}

export function setWorkspaceRootPath(path: string | null): void {
  rootPath = path;
}
