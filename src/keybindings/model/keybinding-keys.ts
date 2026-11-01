const MODIFIERS = ["Ctrl", "Alt", "Shift"];
const SHIFTED_KEYS: Record<string, string> = {
  "|": "\\",
  "?": "/",
  ":": ";",
  '"': "'",
  "{": "[",
  "}": "]",
  "<": ",",
  ">": ".",
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};
const NAMED_KEYS = [
  "Tab",
  "Enter",
  "Space",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
];

export function normalizeBinding(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split("+");
  const key = parts.pop() ?? "";
  if (parts.some((p) => !MODIFIERS.includes(p)) || new Set(parts).size !== parts.length) {
    return null;
  }
  if (
    !/^[a-z0-9,.;/\\='\[\]`-]$/i.test(key) &&
    !NAMED_KEYS.includes(key) &&
    !/^F([1-9]|1\d|2[0-4])$/.test(key)
  ) {
    return null;
  }
  // Plain typing and OS-owned combinations must never become app commands.
  if (!parts.includes("Ctrl") && !parts.includes("Alt") && !/^F\d+$/.test(key)) {
    return null;
  }
  const normalized = [
    ...MODIFIERS.filter((m) => parts.includes(m) && !(m === "Shift" && ["=", "-"].includes(key))),
    key.length === 1 ? key.toUpperCase() : key,
  ].join("+");
  if (
    [
      "Alt+F4",
      "Alt+Tab",
      "Alt+Shift+Tab",
      "Ctrl+Alt+Delete",
      "Ctrl+C",
      "Ctrl+V",
      "Ctrl+X",
      "Ctrl+A",
      "Ctrl+Z",
      "Ctrl+Y",
      "Ctrl+Shift+Z",
      "Ctrl+Shift+C",
      "Ctrl+Shift+V",
      "Ctrl+Insert",
    ].includes(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function bindingFromEvent(e: KeyboardEvent): string | null {
  if (e.isComposing || e.getModifierState?.("AltGraph")) {
    return null;
  }
  let key = e.key === " " ? "Space" : e.key;
  let shift = e.shiftKey;
  // Keep both keyboard layouts' usual zoom aliases (+/= and _/-).
  if (key === "+") {
    key = "=";
    shift = false;
  }
  if (key === "_") {
    key = "-";
    shift = false;
  }
  if (shift && SHIFTED_KEYS[key]) {
    key = SHIFTED_KEYS[key];
  }
  return normalizeBinding(
    [
      ...(e.ctrlKey || e.metaKey ? ["Ctrl"] : []),
      ...(e.altKey ? ["Alt"] : []),
      ...(shift ? ["Shift"] : []),
      key,
    ].join("+"),
  );
}
