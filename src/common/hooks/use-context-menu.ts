import { isEditable } from "@/common/dom/input-targets";
import { type ContextMenuItem } from "@/common/model/context-menu";
import { useCallback, useState } from "preact/hooks";

export function useContextMenu() {
  const [state, setState] = useState<{
    id: number;
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((e: MouseEvent, items: ContextMenuItem[]) => {
    if (isEditable(e.target)) {
      return;
    } // text fields keep Cut / Copy / Paste
    e.preventDefault();
    e.stopPropagation(); // innermost target wins (a file row beats the tree background)
    if (items.length) {
      setState((s) => ({ id: (s?.id ?? 0) + 1, x: e.clientX, y: e.clientY, items }));
    }
  }, []);
  const menu = state ? { ...state, onClose: close } : null;
  return { open, close, menu };
}
