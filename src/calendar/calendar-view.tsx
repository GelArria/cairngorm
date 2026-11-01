import { RadioGroup, RadioGroupItem } from "@/common/ui/radio-group";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { SchedulePanel } from "./components/schedule-panel";

const EventCalendar = lazy(() =>
  import("./components/event-calendar").then((module) => ({ default: module.EventCalendar })),
);

export function CalendarView({
  projectId,
  compact = false,
}: {
  projectId: string | null;
  compact?: boolean;
}) {
  const [view, setView] = useState("tasks");
  useEffect(() => {
    const create = (event: Event) => {
      if ((event as CustomEvent).detail?.kind === "calendar-event") {
        setView("tasks");
      }
    };
    window.addEventListener("app-create", create);
    return () => window.removeEventListener("app-create", create);
  }, []);
  return (
    <div data-testid="calendar-view" class="flex h-full min-h-0 flex-col overflow-hidden">
      <RadioGroup
        value={view}
        onValueChange={setView}
        aria-label="Calendar section"
        class="flex shrink-0 gap-1 border-b border-border p-2"
      >
        {[
          ["tasks", "Scheduled tasks"],
          ["events", "Calendar events"],
        ].map(([value, label]) => (
          <RadioGroupItem
            key={value}
            value={value}
            class="min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground data-[state=checked]:bg-accent data-[state=checked]:text-foreground"
          >
            {label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <div class={view === "tasks" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <SchedulePanel key={projectId} projectId={projectId} />
      </div>
      {view === "events" && (
        <Suspense fallback={<p class="p-3 text-xs text-muted-foreground">Loading calendar…</p>}>
          <EventCalendar projectId={projectId} compact={compact} />
        </Suspense>
      )}
    </div>
  );
}
