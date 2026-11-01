import { cn } from "@/common/utils";

interface ProgressProps {
  /** 0–100; values outside the range are clamped. */
  value: number;
  class?: string;
  indicatorClass?: string;
  "aria-label"?: string;
}

// shadcn/ui Progress: a track with a translated indicator.
export function Progress({
  value,
  class: className,
  indicatorClass,
  "aria-label": label,
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      class={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15", className)}
    >
      <div
        class={cn("h-full w-full flex-1 bg-primary transition-transform", indicatorClass)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </div>
  );
}
