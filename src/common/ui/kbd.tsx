import { cn } from "@/common/utils";

/** Keyboard key chips — keys={["Ctrl", "Shift", "W"]}. */
export function Kbd({ keys, class: className }: { keys: string[]; class?: string }) {
  return (
    <span class={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          class="min-w-[18px] rounded border border-border bg-secondary px-1 py-px text-center font-mono text-[10px] leading-4 text-muted-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
