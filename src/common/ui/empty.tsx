// shadcn/ui Empty, for Preact: a centred "nothing here yet" composed of media, title,
// description and content. The icon tile can take the project's stone colour.
import { cn } from "@/common/utils";
import type { ComponentChildren, JSX } from "preact";

type DivProps = JSX.HTMLAttributes<HTMLDivElement> & { class?: string };

export function Empty({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="empty"
      class={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 text-balance px-4 py-6 text-center",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyHeader({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="empty-header"
      class={cn("flex max-w-[240px] flex-col items-center gap-1.5 text-center", className)}
      {...props}
    />
  );
}

/**
 * `icon`: a small tile with a hairline ring and a soft top light, tinted with `accent`
 * when given (a stone colour), neutral otherwise.
 */
export function EmptyMedia({
  variant = "default",
  accent,
  class: className,
  children,
}: {
  variant?: "default" | "icon";
  accent?: string;
  class?: string;
  children: ComponentChildren;
}) {
  if (variant === "default") {
    return (
      <div
        data-slot="empty-icon"
        class={cn("mb-1 flex shrink-0 items-center justify-center", className)}
      >
        {children}
      </div>
    );
  }
  const tint = accent ?? "hsl(var(--muted-foreground))";
  return (
    <div
      data-slot="empty-icon"
      data-variant="icon"
      class={cn(
        // Plain tile first: webviews without color-mix() keep it, the inline style refines it.
        "mb-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-[18px] ring-1 ring-border [&_svg]:pointer-events-none",
        className,
      )}
      style={{
        color: accent ? `color-mix(in srgb, ${tint} 70%, hsl(var(--foreground)))` : undefined,
        background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 18%, transparent), color-mix(in srgb, ${tint} 6%, transparent))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 28%, transparent), inset 0 1px 0 color-mix(in srgb, white 10%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

export function EmptyTitle({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="empty-title"
      class={cn("text-[13px] font-medium leading-5 tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

export function EmptyDescription({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="empty-description"
      class={cn("text-xs leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function EmptyContent({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="empty-content"
      class={cn("flex w-full min-w-0 flex-col items-center gap-2 text-xs", className)}
      {...props}
    />
  );
}
