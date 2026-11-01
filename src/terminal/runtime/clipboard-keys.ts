// Clipboard shortcuts are handled here; all other input belongs to the PTY.
import type { Terminal } from "@xterm/xterm";
import { getTerminalPreferences } from "../data/terminal-preferences";

/**
 * A clipboard image is handed to the program as its own paste key, so agent
 * TUIs attach it: Alt+V on Windows (pi, Claude Code) and a raw Ctrl+V elsewhere.
 */
const imagePasteKey = () => (navigator.platform?.startsWith("Win") ? "\x1bv" : "\x16");

async function clipboardHasImage(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    return items.some((item) => item.types.some((type) => type.startsWith("image/")));
  } catch {
    return false;
  }
}

export function clipboardKeyHandler(e: KeyboardEvent, term: Terminal): boolean {
  if (e.type !== "keydown" || e.altKey) {
    return true;
  }
  const key = e.key.toLowerCase();
  const modified = e.ctrlKey || e.metaKey;
  const windows = getTerminalPreferences().clipboard === "windows";
  const paste =
    (key === "insert" && e.shiftKey) || (modified && key === "v" && (e.shiftKey || windows));
  const copy = modified && key === "c" && (e.shiftKey || (windows && term.hasSelection()));
  if (!paste && !copy) {
    return true;
  }

  e.preventDefault();
  e.stopPropagation();
  if (paste) {
    void navigator.clipboard
      ?.readText()
      .then(async (text) => {
        if (text) {
          term.paste(text);
        } else if (await clipboardHasImage()) {
          term.input(imagePasteKey(), true);
        }
      })
      .catch((error) => console.warn("[terminal] Paste failed", error));
  } else {
    void navigator.clipboard
      ?.writeText(term.getSelection())
      .catch((error) => console.warn("[terminal] Copy failed", error));
  }
  return false;
}

export function attachClipboardKeys(term: Terminal): void {
  term.attachCustomKeyEventHandler((e) => clipboardKeyHandler(e, term));
}
