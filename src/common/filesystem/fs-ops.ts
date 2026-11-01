// Disk operations behind the right-click menus (Rust: fs_ops.rs / git_ops.rs).
// All reject with a readable string — callers surface it in an InlineNotice.
type Invoke = typeof import("@tauri-apps/api/core").invoke;

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  let invoke: Invoke;
  try {
    ({ invoke } = await import("@tauri-apps/api/core"));
  } catch {
    invoke = (window as any).__TAURI_INTERNALS__?.invoke;
    if (!invoke) {
      throw new Error("Tauri API not available");
    }
  }
  return invoke<T>(cmd, args);
}

export const createFile = (path: string) => call<void>("fs_create_file", { path });
export const createDir = (path: string) => call<void>("fs_create_dir", { path });
export const renamePath = (from: string, to: string) => call<void>("fs_rename", { from, to });
export const copyPath = (from: string, to: string) => call<void>("fs_copy", { from, to });
export const deletePath = (path: string) => call<void>("fs_delete", { path });
export const revealPath = (path: string) => call<void>("fs_reveal", { path });
export const openDefault = (path: string) => call<void>("fs_open_default", { path });
export const gitIgnore = (root: string, path: string, local: boolean) =>
  call<string>("git_ignore", { root, path, local });
/** Resolves with the repo report; `error` is set when git refused (the UI must show it). */
export const gitDiscard = (root: string, path: string, untracked: boolean) =>
  call<{ error: string | null }>("git_discard", { root, path, untracked });

/** Why `name` can't be a file / folder name on Windows (the strictest target), or undefined. */
export function nameProblem(name: string): string | undefined {
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
    return 'Names cannot contain \\ / : * ? " < > |';
  }
  if (name === "." || name === "..") {
    return `"${name}" is not a valid name`;
  }
  if (/[. ]$/.test(name)) {
    return "Names cannot end with a dot or a space";
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
    return `"${name}" is a reserved name`;
  }
  return undefined;
}

/** Path helpers — Windows and POSIX separators both appear in what the OS returns. */
export const sep = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
export const joinPath = (base: string, ...parts: string[]) =>
  [base.replace(/[\\/]+$/, ""), ...parts].join(sep(base));
export const baseName = (p: string) =>
  p
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? p;
export const dirName = (p: string) => {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i > 0 ? t.slice(0, i) : t;
};

/** "a.txt" → "a copy.txt" → "a copy 2.txt" … first name `taken` does not claim. */
export function copyName(name: string, taken: (n: string) => boolean): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 1; ; i++) {
    const candidate = `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
}
