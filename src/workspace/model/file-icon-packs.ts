// Lookup tables for the bundled icon styles: Material Icon Theme SVGs (a subset in
// public/file-icons/material, MIT) and short type badges.
const MATERIAL_DIR = "/file-icons/material";

const MATERIAL_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  json: "json",
  jsonc: "json",
  rs: "rust",
  py: "python",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "settings",
  env: "settings",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  pdf: "pdf",
  zip: "zip",
  gz: "zip",
  tar: "zip",
  lock: "lock",
  sh: "console",
  bash: "console",
  ps1: "console",
  bat: "console",
  cmd: "console",
  vue: "vue",
  sql: "database",
  db: "database",
  csv: "table",
  txt: "document",
  log: "document",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  go: "go",
  java: "java",
  lua: "lua",
  xml: "xml",
};

const MATERIAL_BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  "package.json": "npm",
  "package-lock.json": "npm",
  "tsconfig.json": "tsconfig",
  "vite.config.ts": "vite",
  "vite.config.js": "vite",
  "tailwind.config.js": "tailwindcss",
  "tailwind.config.ts": "tailwindcss",
  "readme.md": "readme",
  license: "license",
  "license.md": "license",
  ".nvmrc": "nodejs",
};

const MATERIAL_FOLDERS: Record<string, string> = {
  src: "folder-src",
  source: "folder-src",
  test: "folder-test",
  tests: "folder-test",
  __tests__: "folder-test",
  docs: "folder-docs",
  doc: "folder-docs",
  node_modules: "folder-node",
  public: "folder-public",
  static: "folder-public",
  images: "folder-images",
  img: "folder-images",
  assets: "folder-images",
  components: "folder-components",
  ".github": "folder-github",
  scripts: "folder-scripts",
  config: "folder-config",
  dist: "folder-dist",
  build: "folder-dist",
  out: "folder-dist",
};

/** `app.ts` → "ts"; a dotfile such as `.env` or `.npmrc` is its own type ("env"). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? name.slice(dot + 1) : "").toLowerCase();
}

export function materialIcon(name: string, folder: boolean, open = false): string {
  const lower = name.toLowerCase();
  if (folder) {
    const base = MATERIAL_FOLDERS[lower] ?? "folder";
    return `${MATERIAL_DIR}/${base}${open ? "-open" : ""}.svg`;
  }
  const icon = MATERIAL_BY_NAME[lower] ?? MATERIAL_BY_EXT[extensionOf(name)] ?? "file";
  return `${MATERIAL_DIR}/${icon}.svg`;
}

/** Badge text (at most 3 characters) and colour per type; `null` falls back to a plain file icon. */
const BADGES: Record<string, [string, string]> = {};
for (const [extensions, label, color] of [
  ["ts mts cts", "TS", "#3178c6"],
  ["tsx", "TSX", "#3178c6"],
  ["js mjs cjs", "JS", "#c9a400"],
  ["jsx", "JSX", "#c9a400"],
  ["json jsonc", "{}", "#8a8f98"],
  ["rs", "RS", "#ce5c2b"],
  ["py", "PY", "#3572a5"],
  ["css scss sass less", "CSS", "#7c4dff"],
  ["html htm", "<>", "#e44d26"],
  ["md mdx", "MD", "#4a90a4"],
  ["yaml yml toml ini env", "CFG", "#6b8e23"],
  ["sh bash ps1 bat cmd", "SH", "#4caf50"],
  ["svg png jpg jpeg gif webp ico", "IMG", "#d0457a"],
  ["sql db", "SQL", "#e38c00"],
  ["go", "GO", "#00add8"],
  ["c h", "C", "#5c6bc0"],
  ["cpp hpp", "C++", "#5c6bc0"],
  ["java", "JV", "#b07219"],
  ["vue", "VUE", "#41b883"],
  ["lock", "LCK", "#8a8f98"],
] as const) {
  for (const extension of extensions.split(" ")) {
    BADGES[extension] = [label, color];
  }
}

export function fileBadge(name: string): [string, string] | null {
  return BADGES[extensionOf(name)] ?? null;
}
