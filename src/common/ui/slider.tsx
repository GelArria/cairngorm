import { cn } from "@/common/utils";
import type { JSX } from "preact";

interface SliderProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "onInput"> {
  onValueChange: (value: number) => void;
}

/** Native keyboard/AT range semantics with the app's shadcn tokens. */
export function Slider({ class: className, onValueChange, ...props }: SliderProps) {
  return (
    <input
      {...props}
      type="range"
      class={cn(
        "ui-slider w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onInput={(event) => onValueChange(Number(event.currentTarget.value))}
    />
  );
}
