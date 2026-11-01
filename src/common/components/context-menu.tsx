import { createPortal } from "preact/compat";
import type { useContextMenu } from "../hooks/use-context-menu";
import { UnifiedContextMenu } from "./unified-context-menu";

/** Keep fixed positioning relative to the viewport, outside filtered/clipped panels. */
export function ContextMenu({ menu }: { menu: ReturnType<typeof useContextMenu>["menu"] }) {
  return menu ? createPortal(<UnifiedContextMenu key={menu.id} {...menu} />, document.body) : null;
}
