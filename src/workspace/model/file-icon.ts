// Lucide file icon per file type: code, structured data, images, archives, …
import type { IconName } from "@/common/ui/icon";

const BY_EXT: Record<string, IconName> = {
  ts: "file-code",
  tsx: "file-code",
  js: "file-code",
  jsx: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  css: "file-code",
  html: "file-code",
  vue: "file-code",
  py: "file-code",
  rs: "file-code",
  c: "file-code",
  cpp: "file-code",
  sql: "file-code",
  json: "file-braces",
  yaml: "file-braces",
  yml: "file-braces",
  toml: "file-braces",
  ini: "file-braces",
  md: "file-text",
  txt: "file-text",
  pdf: "file-text",
  csv: "file-sheet",
  sh: "file-terminal",
  ps1: "file-terminal",
  lock: "file-lock",
  zip: "file-archive",
  svg: "file-image",
  png: "file-image",
  jpg: "file-image",
  jpeg: "file-image",
  gif: "file-image",
  webp: "file-image",
};

const COLORS: Record<string, string> = {};
for (const [extensions, color] of [
  ["ts tsx c cpp", "text-blue-600 dark:text-blue-400"],
  ["js jsx mjs cjs py", "text-amber-700 dark:text-amber-300"],
  ["css", "text-violet-600 dark:text-violet-400"],
  ["html rs", "text-orange-700 dark:text-orange-300"],
  ["vue json yaml yml toml ini csv sql sh ps1", "text-emerald-700 dark:text-emerald-400"],
  ["md", "text-cyan-700 dark:text-cyan-300"],
  ["svg png jpg jpeg gif webp pdf", "text-rose-600 dark:text-rose-400"],
  ["zip lock", "text-amber-700 dark:text-amber-300"],
]) {
  for (const extension of extensions.split(" ")) {
    COLORS[extension] = color;
  }
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileIcon(name: string): IconName {
  return BY_EXT[extension(name)] ?? "file-text";
}

/** Keep the type color on selection; explicit global icon overrides still win. */
export function fileIconColor(name: string): string {
  return COLORS[extension(name)] ?? "text-muted-foreground";
}

/** Git porcelain code → single letter + colour for the tree. */
export function gitMark(code: string | undefined): { letter: string; cls: string } | null {
  if (!code) {
    return null;
  }
  if (code === "??") {
    return { letter: "U", cls: "text-neutral-500" };
  }
  const c = code[0] !== " " ? code[0] : code[1];
  if (c === "A") {
    return { letter: "A", cls: "text-green-500" };
  }
  if (c === "D") {
    return { letter: "D", cls: "text-red-500" };
  }
  if (c === "R") {
    return { letter: "R", cls: "text-blue-500" };
  }
  return { letter: "M", cls: "text-yellow-500" };
}
