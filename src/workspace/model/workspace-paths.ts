export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizePath(path: string): string {
  return normalizeSlashes(path).toLowerCase();
}

export function isWithinPath(child: string, parent: string): boolean {
  return !!parent && (child === parent || child.startsWith(parent + "/"));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
