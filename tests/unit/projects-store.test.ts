import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the SQLite projects table
const db = vi.hoisted(() => ({
  rows: [] as {
    id: string;
    name: string;
    root_path: string;
    color: string | null;
    created_at: string;
  }[],
  adopted: [] as string[],
  fail: false,
}));

vi.mock("@/projects/data/projects-db", () => ({
  readProjectRecovery: () => [],
  loadProjects: async () => {
    if (db.fail) throw new Error("no db");
    return db.rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootPath: r.root_path,
      color: r.color ?? undefined,
      createdAt: 0,
    }));
  },
  insertProject: async (p: { id: string; name: string; rootPath: string; color?: string }) => {
    if (db.fail) throw new Error("no db");
    db.rows.push({
      id: p.id,
      name: p.name,
      root_path: p.rootPath,
      color: p.color ?? null,
      created_at: "",
    });
  },
  saveProject: async (p: { id: string; name: string; rootPath: string; color?: string }) => {
    if (db.fail) throw new Error("no db");
    const r = db.rows.find((x) => x.id === p.id)!;
    Object.assign(r, { name: p.name, root_path: p.rootPath, color: p.color ?? null });
  },
  deleteProject: async (id: string) => {
    if (db.fail) throw new Error("no db");
    db.rows = db.rows.filter((r) => r.id !== id);
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "C:/Users/me" }));

let P: typeof import("@/projects/api");
// Node's own localStorage global is unusable here — stub a Map-backed one
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
});

beforeEach(async () => {
  db.rows = [];
  db.adopted = [];
  db.fail = false;
  store.clear();
  vi.resetModules();
  P = await import("@/projects/api");
});

describe("projects store", () => {
  it("first run creates a Home project and invokes the supplied lifecycle", async () => {
    await P.initProjects({
      onFirstProject: async (id) => {
        db.adopted.push(id);
      },
    });
    const s = P.getProjectsState();
    expect(s.ready).toBe(true);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]).toMatchObject({ name: "Home", rootPath: "C:/Users/me" });
    expect(s.activeId).toBe(s.projects[0].id);
    expect(db.rows).toHaveLength(1);
    expect(db.adopted).toEqual([s.projects[0].id]);
  });

  it("create switches to the new project (named after its folder) and persists it", async () => {
    await P.initProjects();
    const p = P.createProject("D:\\code\\cairngorm\\");
    expect(p.name).toBe("cairngorm");
    expect(P.getProjectsState().activeId).toBe(p.id);
    expect(P.getActiveProject()?.rootPath).toBe("D:\\code\\cairngorm\\");
    await Promise.resolve();
    expect(db.rows.map((r) => r.id)).toContain(p.id);
  });

  it("restores the last active project on the next launch", async () => {
    await P.initProjects();
    const p = P.createProject("D:/b");
    vi.resetModules();
    P = await import("@/projects/api");
    await P.initProjects();
    expect(P.getProjectsState().activeId).toBe(p.id);
    expect(P.getProjectsState().projects).toHaveLength(2);
  });

  it("rename / color / folder are applied and persisted; blank names are ignored", async () => {
    await P.initProjects();
    const id = P.getProjectsState().activeId!;
    P.renameProject(id, "  Work  ");
    P.renameProject(id, "   ");
    P.setProjectColor(id, "blue");
    P.setProjectRoot(id, "E:/work");
    expect(P.getActiveProject()).toMatchObject({
      name: "Work",
      color: "blue",
      rootPath: "E:/work",
    });
    expect(db.rows[0]).toMatchObject({ name: "Work", color: "blue", root_path: "E:/work" });
  });

  it("removing the active project switches to another; the last one can't be removed", async () => {
    await P.initProjects();
    const home = P.getProjectsState().activeId!;
    const b = P.createProject("D:/b");
    expect(await P.removeProject(b.id)).toBe(true);
    expect(P.getProjectsState().activeId).toBe(home);
    expect(await P.removeProject(home)).toBe(false);
    expect(P.getProjectsState().projects).toHaveLength(1);
  });

  it("works in memory when the database is unavailable", async () => {
    db.fail = true;
    await P.initProjects();
    expect(P.getProjectsState().projects).toHaveLength(1);
    P.createProject("D:/x");
    expect(P.getProjectsState().projects).toHaveLength(2);
    expect(db.rows).toHaveLength(0);
  });

  it("runs supplied cleanup before deleting the project row", async () => {
    const beforeDelete = vi.fn(async (id: string) => {
      expect(db.rows.some((row) => row.id === id)).toBe(true);
    });
    await P.initProjects({ beforeDelete });
    const project = P.createProject("D:/cleanup");
    await P.removeProject(project.id);
    await vi.waitFor(() => expect(db.rows.some((row) => row.id === project.id)).toBe(false));
    expect(beforeDelete).toHaveBeenCalledWith(project.id);
  });

  it("preserves the selected project and terminal cleanup when scheduled work refuses deletion", async () => {
    const beforeDelete = vi.fn(async () => {
      throw new Error("A scheduled task is running");
    });
    const onDelete = vi.fn();
    await P.initProjects({ beforeDelete, onDelete });
    const project = P.createProject("D:/running");
    await expect(P.removeProject(project.id)).rejects.toThrow("A scheduled task is running");
    expect(P.getActiveProject()?.id).toBe(project.id);
    expect(P.getProjectsState().projects).toHaveLength(2);
    expect(db.rows.some((row) => row.id === project.id)).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps a fallback project visible when its deletion cannot be persisted", async () => {
    db.fail = true;
    const beforeDelete = vi.fn(async () => {});
    const onDelete = vi.fn((id: string) => {
      expect(P.getProjectsState().projects.some((project) => project.id === id)).toBe(true);
    });
    await P.initProjects({ beforeDelete, onDelete });
    const project = P.createProject("D:/fallback");
    await expect(P.removeProject(project.id)).rejects.toThrow("no db");
    expect(beforeDelete).toHaveBeenCalledWith(project.id);
    expect(onDelete).not.toHaveBeenCalled();
    expect(P.getProjectsState().projects).toHaveLength(2);
  });

  it("does not remove both remaining projects concurrently", async () => {
    let finish!: () => void;
    await P.initProjects({
      beforeDelete: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const home = P.getActiveProject()!.id;
    const project = P.createProject("D:/second");
    const removal = P.removeProject(project.id);
    expect(await P.removeProject(home)).toBe(false);
    finish();
    expect(await removal).toBe(true);
    expect(P.getProjectsState().projects).toHaveLength(1);
  });

  it("recovers caller-supplied project identities when persistence is unavailable", async () => {
    db.fail = true;
    const project = { id: "recovered", name: "Recovered", rootPath: "D:/saved", createdAt: 0 };
    await P.initProjects({ recover: () => ({ projects: [project], activeId: project.id }) });
    expect(P.getActiveProject()).toEqual(project);
    expect(db.rows).toEqual([]);
  });

  it("adopts workspace projects created while the database was unreadable", async () => {
    db.rows = [{ id: "a", name: "A", root_path: "C:/a", color: null, created_at: "" }];
    store.set("active-project-id", "orphan");
    const orphan = { id: "orphan", name: "Orphan", rootPath: "D:/new", createdAt: 0 };
    await P.initProjects({
      recover: () => ({
        projects: [{ id: "a", name: "A", rootPath: "C:/a", createdAt: 0 }, orphan],
      }),
    });
    expect(P.getProjectsState().projects.map((p) => p.id)).toEqual(["a", "orphan"]);
    expect(P.getProjectsState().activeId).toBe("orphan");
    expect(db.rows.map((r) => r.id)).toEqual(["a", "orphan"]);
  });
});

describe("sidebar side", () => {
  it("defaults to bottom, toggles within each orientation and persists", async () => {
    const S = await import("@/common/layout/sidebar-side");
    expect(S.getSidebarSide()).toBe("bottom");
    S.toggleSidebarSide();
    expect(S.getSidebarSide()).toBe("top");
    expect(localStorage.getItem("sidebar-side")).toBe("top");
    expect(S.innerSide("top")).toBe("bottom");
    expect(S.innerSide("bottom")).toBe("top");
    S.toggleSidebarSide();
    expect(S.getSidebarSide()).toBe("bottom");
    S.setSidebarSide("left");
    S.toggleSidebarSide();
    expect(S.getSidebarSide()).toBe("right");
    expect(localStorage.getItem("sidebar-side")).toBe("right");
    expect(S.innerSide("right")).toBe("left");
    S.setSidebarSide("left");
    expect(localStorage.getItem("sidebar-side")).toBe("left");
  });
});
