import { cn } from "@/common/utils";
import type { JSX } from "preact";

interface LabelProps extends JSX.LabelHTMLAttributes<HTMLLabelElement> {}

export function Label({ class: className, ...props }: LabelProps) {
  return (
    <label
      class={cn("mb-1 block text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}
