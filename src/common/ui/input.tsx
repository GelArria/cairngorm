import { cn } from "@/common/utils";
import type { JSX } from "preact";

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ class: className, ...props }: InputProps) {
  return (
    <input
      class={cn(
        "flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
