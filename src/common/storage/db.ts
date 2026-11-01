interface DbInstance {
  select<T>(query: string, values?: unknown[]): Promise<T[]>;
  execute(query: string, values?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

let dbInstance: Promise<DbInstance> | null = null;

function getDb(): Promise<DbInstance> {
  // Share the in-flight open too: projects and calendar start concurrently.
  dbInstance ??= import("@tauri-apps/plugin-sql")
    .then(async (mod) => (await mod.default.load("sqlite:panel.db")) as unknown as DbInstance)
    .catch((err) => {
      dbInstance = null;
      throw err;
    });
  return dbInstance;
}

export async function select<T>(query: string, values?: unknown[]): Promise<T[]> {
  const db = await getDb();
  return db.select<T>(query, values);
}

export async function execute(query: string, values?: unknown[]): Promise<void> {
  const db = await getDb();
  await db.execute(query, values);
}

export async function close(): Promise<void> {
  if (dbInstance) {
    await (await dbInstance).close();
    dbInstance = null;
  }
}
