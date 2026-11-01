// Projects store (module singleton + listeners, same pattern as use-git-status).
// Persisted in SQLite; the active project id lives in localStorage. When the DB
// is unavailable it uses the recovery supplied by the app.
import { reportStorageFallback } from "@/common/storage/storage-health";
import { catchLog } from "@/debug/data/safe";
import {
  deleteProject,
  insertProject,
  loadProjects,
  readProjectRecovery,
  saveProject,
} from "../data/projects-db";
import { folderName, type Project, type ProjectLifecycle } from "../model/project-types";

export interface ProjectsState {
  projects: Project[];
  activeId: string | null;
  ready: boolean;
}

const ACTIVE_KEY = "active-project-id";
let state: ProjectsState = { projects: [], activeId: null, ready: false };
const listeners = new Set<(s: ProjectsState) => void>();
let dbOk = true;
let beforeDelete: ProjectLifecycle["beforeDelete"];
let onDelete: ProjectLifecycle["onDelete"];
let deleting = false;

function set(patch: Partial<ProjectsState>) {
  state = { ...state, ...patch };
  if (patch.activeId) {
    try {
      localStorage.setItem(ACTIVE_KEY, patch.activeId);
    } catch {
      /* no storage */
    }
  }
  listeners.forEach((l) => l(state));
}

const persist = (op: () => Promise<void>) => {
  op().catch((error) => {
    reportStorageFallback("projects", error);
    catchLog("projects")(error);
  });
};

export function getProjectsState(): ProjectsState {
  return state;
}

export function getActiveProject(): Project | null {
  return state.projects.find((p) => p.id === state.activeId) ?? null;
}

export function subscribeProjects(fn: (s: ProjectsState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function makeProject(rootPath: string, name?: string): Project {
  return {
    id: crypto.randomUUID(),
    name: (name ?? folderName(rootPath)).slice(0, 40),
    rootPath,
    createdAt: Date.now(),
  };
}

async function homeDir(): Promise<string> {
  try {
    return await (await import("@tauri-apps/api/path")).homeDir();
  } catch {
    return "";
  }
}

let initPromise: Promise<void> | null = null;

/** Loads projects once; first run creates a "Home" project at the home dir. */
export function initProjects(lifecycle: ProjectLifecycle = {}): Promise<void> {
  initPromise ??= (async () => {
    beforeDelete = lifecycle.beforeDelete;
    onDelete = lifecycle.onDelete;
    let projects: Project[] = [];
    let recoveredActiveId: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        projects = await loadProjects();
        break;
      } catch (error) {
        console.warn("[projects] could not load projects", error);
        if (attempt === 0) {
          continue;
        }
        dbOk = false;
        reportStorageFallback("projects", error);
        // A failed read is not an empty DB: keep the IDs that own the saved grids.
        const recovered = lifecycle.recover?.();
        recoveredActiveId = recovered?.activeId;
        projects = recovered?.projects ?? [];
      }
    }
    if (!dbOk) {
      try {
        const pending = readProjectRecovery();
        projects = [
          ...projects.filter((p) => !pending.some((saved) => saved.id === p.id)),
          ...pending,
        ];
      } catch (error) {
        catchLog("projects")(error);
      }
    }
    if (dbOk) {
      // Projects created while the DB was unreadable live only in the saved workspace;
      // adopt them so the group sync does not discard their tabs and layouts.
      const orphans = (lifecycle.recover?.()?.projects ?? []).filter(
        (p) => !projects.some((q) => q.id === p.id),
      );
      for (const orphan of orphans) {
        const project = { ...orphan, createdAt: orphan.createdAt || Date.now() };
        try {
          await insertProject(project);
          projects = [...projects, project];
        } catch (e) {
          catchLog("projects")(e);
        }
      }
    }
    if (projects.length === 0) {
      const home = makeProject(await homeDir(), "Home");
      projects = [home];
      if (dbOk) {
        try {
          await insertProject(home);
        } catch (e) {
          dbOk = false;
          reportStorageFallback("projects", e);
        }
      }
    }
    // Projects created while loading (early Open Folder) are kept
    projects = [...projects, ...state.projects.filter((p) => !projects.some((q) => q.id === p.id))];
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ACTIVE_KEY);
    } catch {
      /* no storage */
    }
    const want = state.activeId ?? stored;
    const activeId = projects.some((p) => p.id === want)
      ? want!
      : projects.some((p) => p.id === recoveredActiveId)
        ? recoveredActiveId!
        : projects[0].id;
    if (dbOk) {
      lifecycle.onFirstProject?.(projects[0].id).catch(catchLog("projects"));
    }
    set({ projects, activeId, ready: true });
  })();
  return initPromise;
}

export function createProject(rootPath: string, name?: string): Project {
  const p = makeProject(rootPath, name);
  set({ projects: [...state.projects, p], activeId: p.id });
  persist(() => insertProject(p));
  return p;
}

export function switchProject(id: string) {
  if (id !== state.activeId && state.projects.some((p) => p.id === id)) {
    set({ activeId: id });
  }
}

function update(id: string, patch: Partial<Project>) {
  const cur = state.projects.find((p) => p.id === id);
  if (!cur) {
    return;
  }
  const next = { ...cur, ...patch };
  set({ projects: state.projects.map((p) => (p.id === id ? next : p)) });
  persist(() => saveProject(next));
}

export function renameProject(id: string, name: string) {
  const clean = name.trim();
  if (clean) {
    update(id, { name: clean.slice(0, 40) });
  }
}

export function setProjectColor(id: string, color: string | null) {
  update(id, { color: color ?? undefined });
}

export function setProjectRoot(id: string, rootPath: string) {
  update(id, { rootPath });
}

/** null = back to the app's default preset for this project. */
export function setProjectBackground(id: string, background: string | null) {
  update(id, { background: background ?? undefined });
}

/** null = back to the oval (brand) cut. */
export function setProjectCut(id: string, cut: string | null) {
  update(id, { cut: cut ?? undefined });
}

/** The last project can't be removed (the app always has an active one). */
export async function removeProject(id: string): Promise<boolean> {
  if (deleting || state.projects.length <= 1 || !state.projects.some((p) => p.id === id)) {
    return false;
  }
  deleting = true;
  try {
    // Related cleanup can refuse removal even when SQLite is unavailable.
    await beforeDelete?.(id);
    await deleteProject(id);
    onDelete?.(id);
    const projects = state.projects.filter((p) => p.id !== id);
    set({ projects, activeId: state.activeId === id ? projects[0].id : state.activeId });
    return true;
  } finally {
    deleting = false;
  }
}

/** Resolves once projects are loaded (immediately when sync never started, e.g. detached windows). */
export function whenProjectsReady(): Promise<void> {
  return initPromise ?? Promise.resolve();
}

/** Tests only. */
export function __resetProjects() {
  state = { projects: [], activeId: null, ready: false };
  initPromise = null;
  dbOk = true;
  beforeDelete = undefined;
  onDelete = undefined;
  deleting = false;
}
