// Where a `cairngorm` command request opens: which project, and the folder its terminal
// or agent starts in. Pure, so the routing rules are testable without the app.
import type { SidebarModuleRequest } from "@/common/events/app-events";

export interface LaunchRequest {
  path: string | null;
  isFile: boolean;
  terminal: boolean;
  agent: string | null;
  panel: SidebarModuleRequest | null;
  /** "" opens Settings on its last page. */
  settings: string | null;
}

export interface LaunchTarget {
  /** Existing project to switch to, or null to create one on `projectFolder`. */
  projectId: string | null;
  projectFolder: string;
  /** Where a requested terminal or agent starts. */
  cwd: string;
}

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function parentFolder(path: string): string {
  const parent = path.replace(/[\\/]+[^\\/]*$/, "");
  // "C:\notes.md" → "C:\", "/notes.md" → "/"
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent || "/";
}

/** A path inside an existing project opens in that project (the deepest one); anything
 * else becomes a new project on the folder itself, or on a file's folder. */
export function launchTarget(
  request: LaunchRequest,
  projects: readonly { id: string; rootPath: string }[],
): LaunchTarget | null {
  if (!request.path) {
    return null;
  }
  const cwd = request.isFile ? parentFolder(request.path) : request.path;
  const wanted = normalize(request.path);
  const owner = projects
    .filter((p) => p.rootPath)
    .map((p) => ({ id: p.id, root: normalize(p.rootPath) }))
    .filter(
      ({ root }) => wanted === root || wanted.startsWith(root.endsWith("/") ? root : `${root}/`),
    )
    .sort((a, b) => b.root.length - a.root.length)[0];
  return { projectId: owner?.id ?? null, projectFolder: cwd, cwd };
}
