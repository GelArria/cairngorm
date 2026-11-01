import { cn } from "@/common/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentChildren } from "preact";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ComponentChildren;
  class?: string;
  title?: string;
}

export function Badge({ variant, children, class: className, title }: BadgeProps) {
  return (
    <span class={cn(badgeVariants({ variant, className }))} title={title}>
      {children}
    </span>
  );
}
