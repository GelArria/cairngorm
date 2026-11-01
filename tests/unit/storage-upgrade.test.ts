// The break these catch: a migration or a store query that no longer fits a database written
// by an earlier release, so projects, calendar events or the terminal workspace read as empty
// after an update. Real SQLite (node:sqlite) runs the shipped migration files and the real
// stores and SQL plugin; only the Tauri IPC transport is replaced.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = path.resolve("src-tauri/migrations");
const migrations = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    version: Number(name.slice(0, 3)),
    sql: readFileSync(path.join(dir, name), "utf8"),
  }));

let db: DatabaseSync;
const saved = new Map<string, string>();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: vi.fn(async () => {}), onCloseRequested: vi.fn() }),
}));

/** Applies the shipped migrations from `from` through `to` (inclusive), as an install would. */
function migrate(from: number, to: number) {
  for (const m of migrations.filter((m) => m.version >= from && m.version <= to)) {
    db.exec(m.sql);
  }
}

beforeEach(() => {
  vi.resetModules();
  db = new DatabaseSync(":memory:");
  const invoke = vi.fn(async (cmd: string, args: { query?: string; values?: unknown[] }) => {
    const values = (args?.values ?? []).map((v) => (v === undefined ? null : v)) as never[];
    if (cmd === "plugin:sql|load") return "sqlite:panel.db";
    if (cmd === "plugin:sql|select") return db.prepare(args.query!).all(...values);
    if (cmd === "plugin:sql|execute") {
      const result = db.prepare(args.query!).run(...values);
      return [Number(result.changes), Number(result.lastInsertRowid)];
    }
    return null;
  });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
  db.close();
});

describe("a database from an earlier release", () => {
  it("recovers a failed project rename and appearance update after restarting the store", async () => {
    migrate(1, migrations.at(-1)!.version);
    const original = { id: "recovery", name: "Before", rootPath: "C:/before", createdAt: 0 };
    let projects = await import("@/projects/data/projects-db");
    await projects.insertProject(original);
    db.exec(
      "CREATE TRIGGER refuse_project_update BEFORE UPDATE ON projects WHEN NEW.name = 'After' BEGIN SELECT RAISE(ABORT, 'database is locked'); END",
    );
    const latest = {
      ...original,
      name: "After",
      rootPath: "C:/after",
      color: "blue",
      background: "preset:ruby",
      cut: "round",
    };
    const olderWrite = projects.saveProject({ ...original, name: "Intermediate" });
    const failedLatest = expect(projects.saveProject(latest)).rejects.toThrow("database is locked");
    await olderWrite;
    await failedLatest;
    db.exec("DROP TRIGGER refuse_project_update");
    vi.resetModules();
    projects = await import("@/projects/data/projects-db");
    const { createdAt: _createdAt, ...expected } = latest;
    expect(await projects.loadProjects()).toMatchObject([expected]);
    vi.resetModules();
    projects = await import("@/projects/data/projects-db");
    expect(await projects.loadProjects()).toMatchObject([expected]);

    db.exec(
      "CREATE TRIGGER refuse_project_insert BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'database is locked'); END",
    );
    const pending = { ...original, id: "failed-create", name: "Offline project" };
    await expect(projects.insertProject(pending)).rejects.toThrow("database is locked");
    db.exec("DROP TRIGGER refuse_project_insert");
    await projects.saveProject({ ...pending, name: "Online again" });
    expect(db.prepare("SELECT name FROM projects WHERE id = ?").get(pending.id)).toMatchObject({
      name: "Online again",
    });
    expect(projects.readProjectRecovery()).toEqual([]);
  });

  it("does not acknowledge a newer equal edit when an older write completes", async () => {
    migrate(1, migrations.at(-1)!.version);
    let projects = await import("@/projects/data/projects-db");
    const original = { id: "repeated", name: "Before", rootPath: "C:/repeated", createdAt: 0 };
    await projects.insertProject(original);
    db.exec(
      "CREATE TRIGGER refuse_last_edit BEFORE UPDATE ON projects WHEN OLD.name = 'B' AND NEW.name = 'A' BEGIN SELECT RAISE(ABORT, 'database is locked'); END",
    );
    const first = projects.saveProject({ ...original, name: "A" });
    const middle = projects.saveProject({ ...original, name: "B" });
    const last = expect(projects.saveProject({ ...original, name: "A" })).rejects.toThrow(
      "database is locked",
    );
    await Promise.all([first, middle, last]);
    expect(projects.readProjectRecovery()).toMatchObject([{ id: original.id, name: "A" }]);
    db.exec("DROP TRIGGER refuse_last_edit");
    vi.resetModules();
    projects = await import("@/projects/data/projects-db");
    expect(await projects.loadProjects()).toMatchObject([{ id: original.id, name: "A" }]);
  });

  it("keeps first-release calendar events through every later migration", async () => {
    migrate(1, 1);
    db.exec(
      `INSERT INTO calendar_events (id, title, date, start_time, end_time, color, description)
       VALUES ('ev-1', 'Standup', '2026-09-28', '09:00', '09:30', '#3b82f6', 'daily')`,
    );
    db.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    migrate(2, migrations.at(-1)!.version);

    const calendar = await import("@/calendar/data/calendar-db");
    const projects = await import("@/projects/data/projects-db");
    expect(await projects.loadProjects()).toEqual([]);
    const legacy = await calendar.loadEvents(null);
    expect(legacy).toMatchObject([
      { id: "ev-1", title: "Standup", date: "2026-09-28", time: "09:00", duration: 30 },
    ]);
    // The first project adopts events created before projects existed.
    await projects.insertProject({ id: "p1", name: "Home", rootPath: "C:/home", createdAt: 0 });
    await calendar.adoptUnassignedEvents("p1");
    expect(await calendar.loadEvents("p1")).toMatchObject([{ id: "ev-1" }]);
    expect(await calendar.loadEvents(null)).toEqual([]);
  });

  it("keeps projects saved before terminal state moved into SQLite", async () => {
    migrate(1, 12);
    db.exec(
      `INSERT INTO projects (id, name, root_path, color, background, gem_cut, created_at)
       VALUES ('p1', 'Cairngorm', 'C:/repo', '#a855f7', 'aurora', 'oval', '2026-10-06 12:00:00')`,
    );
    // A workspace saved by that release lived in WebView localStorage.
    const { WORKSPACE_KEY } = await import("@/terminal/data/workspace-storage");
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [], activeTabId: null }));
    migrate(13, migrations.at(-1)!.version);

    const projects = await import("@/projects/data/projects-db");
    expect(await projects.loadProjects()).toMatchObject([
      { id: "p1", name: "Cairngorm", rootPath: "C:/repo", background: "aurora", cut: "oval" },
    ]);
    const storage = await import("@/terminal/data/native-storage");
    await storage.initializeStorage(WORKSPACE_KEY);
    expect(storage.nativeStorageAvailable()).toBe(true);
    expect(JSON.parse(storage.peekStored(WORKSPACE_KEY)!)).toEqual({ tabs: [], activeTabId: null });
    // The old copy moves into SQLite on the next save.
    storage.writeStored(WORKSPACE_KEY, JSON.stringify({ tabs: [], activeTabId: "t1" }));
    await storage.flushStorage();
    const row = db.prepare("SELECT value FROM terminal_state WHERE key = ?").get(WORKSPACE_KEY) as
      | { value: string }
      | undefined;
    expect(JSON.parse(row!.value)).toEqual({ tabs: [], activeTabId: "t1" });
  });
});
