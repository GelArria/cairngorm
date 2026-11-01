import { catchLog } from "@/debug/data/safe";
import { lazy } from "preact/compat";

// Lazy imports — each view becomes a separate Vite chunk
const importers = {
  calendar: () => import("@/calendar/calendar-view").then((m) => ({ default: m.CalendarView })),
};

export const LazyCalendarView = lazy(importers.calendar);

// Preload a view's chunk on hover — by click time, chunk is cached
const preloaded = new Set<string>();
export function preloadView(view: string) {
  if (preloaded.has(view)) {
    return;
  }
  const imp = (importers as Record<string, () => Promise<any>>)[view];
  if (imp) {
    preloaded.add(view);
    imp().catch(catchLog("lazy-import", "async")); // fire-and-forget
  }
}
