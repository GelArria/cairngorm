// Explorer icon style, chosen in Settings ▸ Themes & colors. One shared store: every
// tree, search list and window follows the choice at once.

export type FileIconTheme = "colored" | "material" | "badges" | "monochrome" | "minimal";

export const FILE_ICON_THEMES: { id: FileIconTheme; label: string; hint: string }[] = [
  { id: "colored", label: "Outline", hint: "Line icons tinted by file type" },
  { id: "material", label: "Material", hint: "Full-colour icons from Material Icon Theme" },
  { id: "badges", label: "Badges", hint: "Short type labels, like TS or RS" },
  { id: "monochrome", label: "Monochrome", hint: "Line icons by type, no colour" },
  { id: "minimal", label: "Minimal", hint: "One quiet icon for files and folders" },
];

const KEY = "file-icon-theme";
const listeners = new Set<(theme: FileIconTheme) => void>();

function read(): FileIconTheme {
  try {
    const value = window.localStorage.getItem(KEY);
    return FILE_ICON_THEMES.some((t) => t.id === value) ? (value as FileIconTheme) : "colored";
  } catch {
    return "colored";
  }
}

let current: FileIconTheme | null = null;

export function getFileIconTheme(): FileIconTheme {
  current ??= read();
  return current;
}

export function setFileIconTheme(theme: FileIconTheme): void {
  current = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {}
  listeners.forEach((listener) => listener(theme));
}

// Other windows (detached panes) follow through the storage event.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      current = read();
      listeners.forEach((listener) => listener(current!));
    }
  });
}

export function subscribeFileIconTheme(listener: (theme: FileIconTheme) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
