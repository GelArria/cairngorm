import { cn } from "@/common/utils";
import type { ComponentChildren, Ref } from "preact";

interface ScrollAreaProps {
  children: ComponentChildren;
  class?: string;
  /** The scrolling element (virtualized lists read scrollTop / clientHeight). */
  viewportRef?: Ref<HTMLDivElement>;
  [key: string]: unknown;
}

export function ScrollArea({ children, class: className, viewportRef, ...rest }: ScrollAreaProps) {
  return (
    <div {...rest} ref={viewportRef} class={cn("overflow-y-auto overflow-x-hidden", className)}>
      {children}
    </div>
  );
}
