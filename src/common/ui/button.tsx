import { cn } from "@/common/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentChildren, JSX } from "preact";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Quiet toolbar/row control: muted until hovered; aria-pressed = lit (toggles)
        subtle:
          "text-muted-foreground hover:bg-accent/60 hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 rounded-md px-3 text-xs",
        xs: "h-6 rounded-md px-2 text-[11px]",
        lg: "h-10 rounded-md px-8",
        icon: "h-8 w-8",
        "icon-sm": "h-6 w-6 rounded-md",
        "icon-xs": "h-5 w-5 rounded text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  children: ComponentChildren;
}

export function Button({ class: className, variant, size, children, ...props }: ButtonProps) {
  return (
    <button type="button" class={cn(buttonVariants({ variant, size, className }))} {...props}>
      {children}
    </button>
  );
}

export { buttonVariants };
