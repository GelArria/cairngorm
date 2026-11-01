// shadcn/ui Card, for Preact: a bordered surface composed of header (title, description,
// action), content and footer.
import { cn } from "@/common/utils";
import type { JSX } from "preact";

type DivProps = JSX.HTMLAttributes<HTMLDivElement> & { class?: string };

export function Card({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="card"
      class={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card py-4 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-header"
      class={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-4 has-[[data-slot=card-action]]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-title"
      class={cn("text-sm font-semibold leading-none", className)}
      {...props}
    />
  );
}

export function CardDescription({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-description"
      class={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardAction({ class: className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-action"
      class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

export function CardContent({ class: className, ...props }: DivProps) {
  return <div data-slot="card-content" class={cn("px-4", className)} {...props} />;
}

export function CardFooter({ class: className, ...props }: DivProps) {
  return <div data-slot="card-footer" class={cn("flex items-center px-4", className)} {...props} />;
}
