// shadcn/ui RadioGroup, for Preact: one Tab stop for the group; arrows, Home and End
// move the selection (and focus) like native radio buttons. Items render any content.
import { cn } from "@/common/utils";
import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext } from "preact/hooks";

interface Group {
  value: string;
  select: (value: string) => void;
}

const RadioContext = createContext<Group | null>(null);

const KEYS: Record<string, "next" | "prev" | "first" | "last"> = {
  ArrowDown: "next",
  ArrowRight: "next",
  ArrowUp: "prev",
  ArrowLeft: "prev",
  Home: "first",
  End: "last",
};

export function RadioGroup({
  value,
  onValueChange,
  class: className,
  children,
  ...props
}: Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  class?: string;
  children: ComponentChildren;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    const move = KEYS[e.key];
    const group = e.currentTarget as HTMLElement;
    const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!move || index < 0) {
      return;
    }
    e.preventDefault();
    const last = items.length - 1;
    const next =
      move === "first"
        ? 0
        : move === "last"
          ? last
          : move === "next"
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next].focus();
    items[next].click();
  };
  return (
    <RadioContext.Provider value={{ value, select: onValueChange }}>
      <div
        role="radiogroup"
        data-slot="radio-group"
        class={className}
        onKeyDown={onKeyDown}
        {...props}
      >
        {children}
      </div>
    </RadioContext.Provider>
  );
}

export function RadioGroupItem({
  value,
  class: className,
  children,
  ...props
}: Omit<JSX.HTMLAttributes<HTMLButtonElement>, "value"> & {
  value: string;
  class?: string;
  /** Skipped by arrow keys and not selectable. */
  disabled?: boolean;
  children?: ComponentChildren;
}) {
  const group = useContext(RadioContext);
  const checked = group?.value === value;
  return (
    <button
      type="button"
      role="radio"
      data-slot="radio-group-item"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      // Roving focus: only the selected item is in the Tab order.
      tabIndex={checked ? 0 : -1}
      class={className}
      onClick={() => group?.select(value)}
      {...props}
    >
      {children}
    </button>
  );
}

/** The round indicator shadcn draws inside a radio item. */
export function RadioIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
        checked ? "border-primary" : "border-border",
      )}
    >
      {checked && <span class="size-1.5 rounded-full bg-primary" />}
    </span>
  );
}
