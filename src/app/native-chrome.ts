import { isEditable, isTerminalInput } from "@/common/dom/input-targets";

export function suppressNativeChrome(
  target: Document = document,
  dev: boolean = !!(import.meta as any).env?.DEV,
): () => void {
  const onContextMenu = (e: MouseEvent) => {
    if (dev && e.shiftKey) {
      return;
    }
    if (isEditable(e.target)) {
      return;
    }
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (dev || typeof e.key !== "string" || isTerminalInput(e.target)) {
      return;
    }
    const k = e.key.toLowerCase();
    const reload = k === "f5" || ((e.ctrlKey || e.metaKey) && k === "r");
    const print = (e.ctrlKey || e.metaKey) && k === "p";
    if (reload || print) {
      e.preventDefault();
    }
  };
  // capture: runs before any component handler, so no menu can slip through
  target.addEventListener("contextmenu", onContextMenu, true);
  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu, true);
    target.removeEventListener("keydown", onKeyDown, true);
  };
}
