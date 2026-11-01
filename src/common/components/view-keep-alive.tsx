import { CairngormLoader, SHOW_AFTER } from "@/common/branding/";
import type { ComponentChildren } from "preact";
import { Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

const UNMOUNT_AFTER_MS = 60_000;

// A view chunk that is not ready yet: the Cairngorm view loader
function ViewSkeleton() {
  return <CairngormLoader delay={SHOW_AFTER} />;
}

export function ViewKeepAlive({
  active,
  children,
}: {
  active: boolean;
  children: ComponentChildren;
}) {
  const [mounted, setMounted] = useState(false);
  const inactiveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (active && !mounted) {
      setMounted(true);
    }
  }, [active]);

  // Auto-unmount after idle timeout to free DOM nodes
  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (active) {
      clearTimeout(inactiveTimer.current);
    } else {
      inactiveTimer.current = setTimeout(
        () => setMounted(false),
        UNMOUNT_AFTER_MS,
      ) as unknown as number;
    }
    return () => clearTimeout(inactiveTimer.current);
  }, [active, mounted]);

  // Not yet visited — zero DOM, zero hooks from children
  if (!mounted) {
    if (!active) {
      return null;
    }
    return (
      <div class="flex-1 min-h-0 flex flex-col">
        <ViewSkeleton />
      </div>
    );
  }

  // Visited before — keep alive with display toggle
  return (
    <div
      style={{ display: active ? "flex" : "none" }}
      // fade restarts each time the view is shown again (display none → flex)
      class="flex-1 min-h-0 flex flex-col animate-in fade-in duration-150"
    >
      <Suspense fallback={<ViewSkeleton />}>{children}</Suspense>
    </div>
  );
}
