export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

type Invoke = typeof import("@tauri-apps/api/core").invoke;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "avif",
  "svg",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
  "mp4",
  "avi",
  "mkv",
  "mov",
  "webm",
  "zip",
  "tar",
  "gz",
  "bz2",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "sqlite",
  "db",
]);

export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ""));
}

function getExt(name: string): string {
  const parts = name.split(".");
  return parts.length < 2 ? "" : (parts[parts.length - 1] ?? "").toLowerCase();
}

async function getInvoke(): Promise<Invoke> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  } catch {
    const fallback =
      (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.invoke;
    if (fallback) {
      return fallback;
    }
    throw new Error("Tauri API not available");
  }
}

type DialogModule = typeof import("@tauri-apps/plugin-dialog");

async function getDialogApi(): Promise<DialogModule | null> {
  try {
    return await import(/* rollup-ignore */ "@tauri-apps/plugin-dialog");
  } catch {
    return null;
  }
}

export async function openFilesDialog(): Promise<string[] | null> {
  const api = await getDialogApi();
  if (api) {
    const result = await api.open({ multiple: true, directory: false });
    if (!result) {
      return null;
    }
    return Array.isArray(result) ? result : [result];
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      resolve(files ? Array.from(files, (f) => f.name) : null);
    };
    input.click();
  });
}

/** Pick one image (png/jpg/webp/gif/bmp/avif) — null when cancelled or no dialog. */
export async function openImageDialog(): Promise<string | null> {
  const api = await getDialogApi();
  if (!api) {
    return null;
  }
  const result = await api.open({
    multiple: false,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
  });
  if (!result) {
    return null;
  }
  return Array.isArray(result) ? (result[0] ?? null) : result;
}

export async function openFolderDialog(): Promise<string | null> {
  const api = await getDialogApi();
  if (!api) {
    return null;
  }
  const result = await api.open({ directory: true, multiple: false });
  if (!result) {
    return null;
  }
  return Array.isArray(result) ? result[0] : result;
}

export async function readFileContent(path: string): Promise<string> {
  const ext = getExt(path.split(/[\\/]/).pop() ?? "");
  if (isBinaryExtension(ext)) {
    return `[Binary file: ${path.split(/[\\/]/).pop()}]`;
  }
  const invoke = await getInvoke();
  return invoke<string>("fs_read_file", { path });
}

export async function readFileAsDataURL(path: string): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("fs_read_file_data_url", { path });
}

// Writes run off the UI thread in Rust and may finish out of order: chain the
// writes of each path so a quick second save can never be overtaken by the first.
const pendingWrites = new Map<string, Promise<unknown>>();

export function writeFileContent(path: string, content: string): Promise<boolean> {
  const prev = pendingWrites.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const invoke = await getInvoke();
      await invoke<void>("fs_write_file", { path, content });
      return true;
    });
  pendingWrites.set(path, next);
  next
    .finally(() => {
      if (pendingWrites.get(path) === next) {
        pendingWrites.delete(path);
      }
    })
    .catch(() => {});
  return next;
}

export async function listDir(path: string): Promise<FsEntry[]> {
  const invoke = await getInvoke();
  return invoke<FsEntry[]>("fs_list_dir", { path });
}

export async function exists(path: string): Promise<boolean> {
  const invoke = await getInvoke();
  return invoke<boolean>("fs_exists", { path });
}

export interface SearchMatch {
  path: string;
  line: number;
  col: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
  contextBefore: string[];
  contextAfter: string[];
}

export interface SearchBatch {
  batchId: string;
  matches: SearchMatch[];
  done: boolean;
}

/** Streams results as "search-results-batch" events tagged with `batchId` (generated in Rust when omitted). */
export async function searchFiles(
  root: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean,
  includePattern?: string,
  excludePattern?: string,
  contextLines?: number,
  batchId?: string,
): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("fs_search_files", {
    root,
    query,
    caseSensitive,
    wholeWord,
    useRegex,
    includePattern: includePattern ?? "",
    excludePattern: excludePattern ?? "",
    contextLines: contextLines ?? 0,
    batchId,
  });
}

export async function cancelSearch(batchId: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke<void>("fs_search_cancel", { batchId });
}

export async function refreshSearchIndex(root: string): Promise<number> {
  const invoke = await getInvoke();
  return invoke<number>("fs_refresh_search_index", { root });
}

export async function onSearchBatch(callback: (batch: SearchBatch) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<SearchBatch>("search-results-batch", (e) => callback(e.payload));
  return unlisten;
}
