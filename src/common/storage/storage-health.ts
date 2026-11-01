// Which saved data could not use the SQLite database this session. Stores keep working on
// a fallback (WebView storage or memory), so without this the user is never told that what
// they change may not survive a restart.
export type StorageArea = "projects" | "terminals";

const failed = new Set<StorageArea>();
const listeners = new Set<() => void>();

export function reportStorageFallback(area: StorageArea, error: unknown): void {
  console.warn(`[storage] ${area} are not using the database`, error);
  if (failed.has(area)) {
    return;
  }
  failed.add(area);
  listeners.forEach((listener) => listener());
}

export function storageFallbacks(): StorageArea[] {
  return [...failed];
}

export function onStorageFallback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The notice for the areas that fell back, or null when everything uses the database. */
export function storageFallbackMessage(areas: StorageArea[]): string | null {
  if (areas.length === 0) {
    return null;
  }
  const what =
    areas.length === 2
      ? "Projects and terminals"
      : areas[0] === "projects"
        ? "Projects"
        : "Terminals";
  return `${what} could not be saved to Cairngorm's database, so changes may be lost when Cairngorm restarts. Another Cairngorm window may be holding it: close it and restart Cairngorm.`;
}
