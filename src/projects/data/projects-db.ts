// SQLite persistence for projects (table from migration 010).
import { execute, select } from "@/common/storage/db";
import type { Project } from "../model/project-types";

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  color: string | null;
  background: string | null;
  gem_cut: string | null;
  created_at: string;
}

function rowToProject(r: ProjectRow): Project {
  const t = Date.parse(r.created_at.replace(" ", "T") + "Z");
  return {
    id: r.id,
    name: r.name,
    rootPath: r.root_path,
    color: r.color ?? undefined,
    background: r.background ?? undefined,
    cut: r.gem_cut ?? undefined,
    createdAt: Number.isNaN(t) ? 0 : t,
  };
}

const RECOVERY_KEY = "cairngorm-project-recovery-v1";
const UPSERT_PROJECT = `INSERT INTO projects (id, name, root_path, color, background, gem_cut) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, root_path=excluded.root_path,
  color=excluded.color, background=excluded.background, gem_cut=excluded.gem_cut`;
let writes: Promise<void> = Promise.resolve();

type PendingProject = Project & { recoveryRevision?: string };

function readRecovery(): PendingProject[] {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) {
    return [];
  }
  const pending: unknown = JSON.parse(raw);
  if (
    !Array.isArray(pending) ||
    !pending.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.rootPath === "string" &&
        Number.isFinite(p.createdAt) &&
        (p.recoveryRevision === undefined || typeof p.recoveryRevision === "string") &&
        [p.color, p.background, p.cut].every(
          (value) => value === undefined || typeof value === "string",
        ),
    )
  ) {
    throw new Error("The saved project recovery data is invalid; it has not been overwritten.");
  }
  return pending;
}

/** Full pending projects preserve fields that the terminal workspace does not store. */
export function readProjectRecovery(): Project[] {
  return readRecovery().map(({ recoveryRevision: _revision, ...project }) => project);
}

function saveRecovery(pending: PendingProject[]) {
  if (pending.length) {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(pending));
  } else {
    localStorage.removeItem(RECOVERY_KEY);
  }
}

function acknowledge(project: PendingProject) {
  // The revision distinguishes a newer A in an A → B → A sequence from the first A.
  const encoded = JSON.stringify(project);
  saveRecovery(readRecovery().filter((p) => JSON.stringify(p) !== encoded));
}

function persist(project: Project, query: string, values: unknown[]): Promise<void> {
  const pending = { ...project, recoveryRevision: crypto.randomUUID() };
  saveRecovery([...readRecovery().filter((p) => p.id !== project.id), pending]);
  writes = writes
    .catch(() => {})
    .then(async () => {
      await execute(query, values);
      acknowledge(pending);
    });
  return writes;
}

const valuesOf = (p: Project) => [
  p.id,
  p.name,
  p.rootPath,
  p.color ?? null,
  p.background ?? null,
  p.cut ?? null,
];

export async function loadProjects(): Promise<Project[]> {
  // Snapshot before enqueueing: later edits must not be acknowledged ahead of their writes.
  const pending = readRecovery();
  writes = writes
    .catch(() => {})
    .then(async () => {
      for (const project of pending) {
        await execute(UPSERT_PROJECT, valuesOf(project));
        acknowledge(project);
      }
    });
  await writes;
  const rows = await select<ProjectRow>(
    "SELECT id, name, root_path, color, background, gem_cut, created_at FROM projects ORDER BY created_at ASC, rowid ASC",
  );
  return rows.map(rowToProject);
}

export async function insertProject(p: Project): Promise<void> {
  await persist(
    p,
    "INSERT INTO projects (id, name, root_path, color, background, gem_cut) VALUES (?, ?, ?, ?, ?, ?)",
    valuesOf(p),
  );
}

export async function saveProject(p: Project): Promise<void> {
  // Creation may have failed while offline; an UPDATE of a missing row would lose the journal.
  await persist(p, UPSERT_PROJECT, valuesOf(p));
}

/** Removes this module's row; app-owned related data is cleaned up first. */
export async function deleteProject(id: string): Promise<void> {
  writes = writes
    .catch(() => {})
    .then(async () => {
      await execute("DELETE FROM projects WHERE id = ?", [id]);
      saveRecovery(readRecovery().filter((p) => p.id !== id));
    });
  await writes;
}
