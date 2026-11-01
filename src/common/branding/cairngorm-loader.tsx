// Replaces bare "Loading…" text wherever a whole view, panel or the app waits.
// The real string stays under the gem. Sizes: view 96 + 14px · sidebar 48 + 12px
// · inline 24 + 12px (row). Callers gate it with useLoaderGate;
// `delay` covers the places that can't (a Suspense fallback).
import { useEffect, useState } from "preact/hooks";
import { CairngormGem } from "./cairngorm-gem";

type Variant = "view" | "sidebar" | "inline";

const SIZE: Record<Variant, number> = { view: 96, sidebar: 48, inline: 24 };

export function CairngormLoader({
  variant = "view",
  label,
  delay = 0,
  class: className = "",
}: {
  variant?: Variant;
  label?: string;
  /** render nothing for the first `delay` ms (fast loads never flash a still gem) */
  delay?: number;
  class?: string;
}) {
  const [visible, setVisible] = useState(delay <= 0);
  useEffect(() => {
    if (visible) {
      return;
    }
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, []);
  if (!visible) {
    return null;
  }

  if (variant === "inline") {
    return (
      <div role="status" class={`flex items-center gap-2 ${className}`}>
        <CairngormGem size={SIZE.inline} />
        {label && <span class="text-xs text-muted-foreground">{label}</span>}
      </div>
    );
  }
  return (
    <div
      role="status"
      class={`flex h-full w-full flex-col items-center justify-center ${variant === "view" ? "gap-2" : "gap-1.5 py-6"} ${className}`}
    >
      <CairngormGem size={SIZE[variant]} speed={variant === "view" ? 0.0013 : 0.00105} />
      {label && (
        <span
          class={
            variant === "view"
              ? "text-sm text-muted-foreground/75"
              : "text-xs text-muted-foreground"
          }
        >
          {label}
        </span>
      )}
    </div>
  );
}
