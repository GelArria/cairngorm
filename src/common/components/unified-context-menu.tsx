import { ContextMenuItem } from "@/common/model/context-menu";
// Right-click menu (Zed style): flat list, label left / shortcut right, hairline
// separators, no icons. Keyboard: ↑ ↓ Home End move, Enter / Space run, Esc close.
// Closes on outside click, another right-click, scroll, resize or window blur.
import { TAG_COLORS } from "@/appearance/model/tag-colors";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const isRow = (i: ContextMenuItem) => !i.separator && !i.disabled && !i.colors;

export function UnifiedContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  // listeners read the latest values through refs: no re-subscribing on every hover
  const activeRef = useRef(-1);
  activeRef.current = active;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Opened near the right/bottom edge → flip back inside the window
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    setAt({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  const run = (item: ContextMenuItem | undefined) => {
    if (item && isRow(item)) {
      closeRef.current();
      item.action();
    }
  };

  useLayoutEffect(() => {
    const step = (from: number, dir: 1 | -1) => {
      const list = itemsRef.current;
      for (let n = 1; n <= list.length; n++) {
        const i = (from + dir * n + list.length * 2) % list.length;
        if (isRow(list[i])) {
          return i;
        }
      }
      return from;
    };
    const onClose = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (!["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Tab"].includes(k)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // the terminal / editor underneath must not see these keys
      if (k === "Escape" || k === "Tab") {
        onClose();
      } else if (k === "ArrowDown") {
        setActive((a) => step(a, 1));
      } else if (k === "ArrowUp") {
        setActive((a) => step(a < 0 ? 0 : a, -1));
      } else if (k === "Home") {
        setActive(step(-1, 1));
      } else if (k === "End") {
        setActive(step(0, -1));
      } else {
        run(itemsRef.current[activeRef.current]);
      }
    };
    const onOutside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("contextmenu", onOutside, true);
    window.addEventListener("wheel", onClose, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("contextmenu", onOutside, true);
      window.removeEventListener("wheel", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="context-menu"
      role="menu"
      class="fixed z-[80] w-max min-w-[200px] whitespace-nowrap rounded-md border border-border bg-popover p-1 font-sans text-[12px] shadow-xl shadow-black/60 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: at.left, top: at.top }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()} // clicking an item must not steal focus from the terminal / editor
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} role="separator" class="-mx-1 my-1 h-px bg-border" />
        ) : item.colors ? (
          <ColorRow key={i} label={item.label} {...item.colors} onDone={() => closeRef.current()} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            class={`flex h-7 w-full items-center gap-8 rounded px-2.5 text-left outline-none ${
              item.disabled
                ? "cursor-default text-muted-foreground/40"
                : item.danger
                  ? `text-red-400 ${active === i ? "bg-red-500/15" : "hover:bg-red-500/10"}`
                  : `text-foreground ${active === i ? "bg-accent" : "hover:bg-accent"}`
            }`}
            onMouseEnter={() => isRow(item) && setActive(i)}
            onClick={() => run(item)}
          >
            <span class="flex-1">{item.label}</span>
            {item.shortcut && (
              <span class="text-[11px] text-muted-foreground">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

function ColorRow({
  label,
  current,
  onPick,
  onDone,
}: {
  label: string;
  current: string | null | undefined;
  onPick: (c: string | null) => void;
  onDone: () => void;
}) {
  const pick = (c: string | null) => {
    onDone();
    onPick(c);
  };
  const ring = (on: boolean) =>
    on ? "ring-1 ring-foreground/80 ring-offset-1 ring-offset-popover" : "hover:scale-110";
  return (
    <div class="flex items-start gap-1.5 px-2.5 py-2" role="group" aria-label={label}>
      <span class="mr-auto pr-4 leading-[14px] text-muted-foreground">{label}</span>
      <div class="grid grid-cols-7 gap-1.5">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={!current}
          aria-label="No colour"
          title="No colour"
          class={`relative h-3.5 w-3.5 rounded-full border border-muted-foreground/50 transition-transform ${ring(!current)}`}
          onClick={() => pick(null)}
        >
          <i class="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-muted-foreground/70" />
        </button>
        {TAG_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitemradio"
            aria-checked={current === c.id}
            aria-label={c.label}
            title={c.label}
            class={`h-3.5 w-3.5 rounded-full transition-transform ${ring(current === c.id)}`}
            style={{ background: c.hex }}
            onClick={() => pick(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
