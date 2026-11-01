// One layout for every Settings page, so switching tabs never moves the title, the
// inset or the type scale: page title (h3) with an optional description and actions,
// then either padded content or full-width sections (h4) divided by hairlines.
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";

/** Horizontal inset shared by page headers, sections and padded bodies. */
export const SETTINGS_INSET = "px-5";

export function SettingsPage({
  title,
  badge,
  description,
  actions,
  sectioned = false,
  class: className,
  children,
  ...rest
}: {
  title: string;
  /** Shown beside the title, e.g. which agent the page applies to. */
  badge?: ComponentChildren;
  description?: ComponentChildren;
  actions?: ComponentChildren;
  /** Full-width `SettingsSection`s instead of a padded body. */
  sectioned?: boolean;
  class?: string;
  children: ComponentChildren;
  "data-testid"?: string;
  "aria-busy"?: boolean;
}) {
  return (
    <div class={cn("flex min-w-0 flex-col", className)} data-settings-page="" {...rest}>
      <header class={cn("flex flex-wrap items-start gap-x-4 gap-y-3 pb-4 pt-5", SETTINGS_INSET)}>
        <div class="min-w-[200px] flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>
            {badge}
          </div>
          {description && (
            <p class="mt-1.5 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div class="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {sectioned ? (
        <div class="flex flex-col">{children}</div>
      ) : (
        <div class={cn("flex min-w-0 flex-col gap-5 pb-5", SETTINGS_INSET)}>{children}</div>
      )}
    </div>
  );
}

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class={cn("border-t border-border py-4", SETTINGS_INSET)} aria-label={title}>
      <h4 class="mb-3 text-[13px] font-semibold text-foreground">{title}</h4>
      <div class="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** A label with an optional hint, and its control on the right (wrapping below when narrow). */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
      <div class="min-w-[180px] flex-1">
        <div class="text-xs text-foreground">{label}</div>
        {hint && (
          // Wraps between words; long paths still break instead of overflowing.
          <div class="mt-0.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {hint}
          </div>
        )}
      </div>
      <div class="flex max-w-full flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/** A small heading inside a padded page body (catalog shelves, lists). */
export function SettingsGroupTitle({ id, children }: { id?: string; children: ComponentChildren }) {
  return (
    <h4 id={id} class="text-[13px] font-semibold text-foreground">
      {children}
    </h4>
  );
}
