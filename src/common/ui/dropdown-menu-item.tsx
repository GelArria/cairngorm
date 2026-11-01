// Items of the shadcn DropdownMenu (Preact): plain, radio and checkbox items,
// separators and section labels. The menu itself lives in dropdown-menu.tsx.
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export const DropdownContext = createContext<{ close: () => void }>({ close: () => {} });

interface DropdownMenuItemProps {
  children: ComponentChildren;
  onClick?: () => void;
  /** Selected option of a single-choice menu: trailing check. */
  checked?: boolean;
  /** shadcn: greyed out, skipped by clicks and keys. */
  disabled?: boolean;
  /** shadcn: "destructive" items read in the destructive color. */
  variant?: "default" | "destructive";
  class?: string;
  "data-testid"?: string;
  /** With `checked`: one-of-many choice (radio) or an on/off toggle (checkbox). */
  role?: "menuitemradio" | "menuitemcheckbox";
}

export function DropdownMenuItem({
  children,
  onClick,
  checked,
  disabled,
  variant = "default",
  class: className,
  "data-testid": testId,
  role = "menuitemradio",
}: DropdownMenuItemProps) {
  const { close } = useContext(DropdownContext);
  const run = () => {
    if (disabled) {
      return;
    }
    onClick?.();
    close();
  };

  return (
    <div
      class={cn(
        "flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
        checked && "bg-accent/60",
        variant === "destructive" && "text-destructive hover:text-destructive",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      data-testid={testId}
      aria-disabled={disabled || undefined}
      role={checked === undefined ? "menuitem" : role}
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          run();
        }
      }}
      onClick={run}
    >
      {children}
      {checked && (
        <span class="ml-auto flex pl-3 text-xs text-muted-foreground">
          <Icon name="check" />
        </span>
      )}
    </div>
  );
}

export function DropdownMenuSeparator({ class: className }: { class?: string }) {
  return <div role="separator" class={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

export function DropdownMenuLabel({
  children,
  class: className,
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}>
      {children}
    </div>
  );
}

/** shadcn DropdownMenuCheckboxItem: an on/off toggle that reads as a checkbox. */
export function DropdownMenuCheckboxItem(
  props: Omit<DropdownMenuItemProps, "checked" | "role"> & { checked: boolean },
) {
  return <DropdownMenuItem {...props} role="menuitemcheckbox" />;
}
