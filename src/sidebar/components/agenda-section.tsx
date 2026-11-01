import { ContextMenu } from "@/common/components/context-menu";
// Agenda-module sidebar: Today · Tomorrow · Upcoming (next 7 days) event lists.
// Dot = event colour.
import { deleteEvent, loadEvents } from "@/calendar/api";
import type { CalendarEvent } from "@/calendar/model/types";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { SidebarLegend } from "@/common/layout/sidebar-legend";
import { groups as menuGroups } from "@/common/model/context-menu";
import { ScrollArea } from "@/common/ui/scroll-area";
import { useActiveProject } from "@/projects/api";
import { useEffect, useState } from "preact/hooks";
import { eventMeta, groupAgenda } from "../model/agenda-groups";
import { SidebarEmpty } from "./sidebar-empty";

function EventRow({
  ev,
  meta,
  onMenu,
}: {
  ev: CalendarEvent;
  meta: string;
  onMenu: (e: MouseEvent, ev: CalendarEvent) => void;
}) {
  const isClass = ev.color.startsWith("bg-");
  return (
    <div
      data-testid={`sidebar-event-${ev.id}`}
      class="mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-2.5 text-xs hover:bg-secondary"
      onContextMenu={(e) => onMenu(e, ev)}
    >
      <span class="flex w-3 shrink-0 justify-center">
        <span
          class={`h-1.5 w-1.5 rounded-full ${isClass ? ev.color : ""}`}
          style={isClass ? undefined : { background: ev.color }}
        />
      </span>
      <span class="min-w-0 flex-1 truncate text-foreground/90">{ev.title}</span>
      <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{meta}</span>
    </div>
  );
}

export function AgendaSection() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const projectId = useActiveProject()?.id; // agenda of the active project
  useEffect(() => {
    let alive = true;
    loadEvents(projectId ?? null)
      .then((e) => {
        if (alive) {
          setEvents(e);
        }
      })
      .catch(() => {});
    const reload = () =>
      loadEvents(projectId ?? null)
        .then((e) => {
          if (alive) {
            setEvents(e);
          }
        })
        .catch(() => {});
    window.addEventListener("calendar-events-changed", reload);
    return () => {
      alive = false;
      window.removeEventListener("calendar-events-changed", reload);
    };
  }, [projectId]);

  const groups = groupAgenda(events, new Date());
  const cm = useContextMenu();
  const addEvent = () =>
    window.dispatchEvent(new CustomEvent("app-create", { detail: { kind: "calendar-event" } }));
  const eventMenu = (e: MouseEvent, ev: CalendarEvent) =>
    cm.open(
      e,
      menuGroups(
        [{ label: "New Event", action: addEvent }],
        [
          {
            label: "Copy Title",
            action: () => void navigator.clipboard?.writeText(ev.title)?.catch(() => {}),
          },
        ],
        [
          {
            label: "Delete Event",
            danger: true,
            action: () => void deleteEvent(ev.id).catch(() => {}),
          },
        ],
      ),
    );
  const empty = groups.every((g) => g.events.length === 0);
  return (
    <ScrollArea
      class="flex min-h-0 flex-1 flex-col pb-2"
      data-testid="sidebar-agenda"
      onContextMenu={(e: MouseEvent) => cm.open(e, [{ label: "New Event", action: addEvent }])}
    >
      {!empty &&
        groups.map((g) => (
          <div key={g.key}>
            <SidebarLegend
              label={g.label}
              count={g.events.length}
              class={g.key === "today" ? "pt-2" : ""}
              onAdd={g.key === "today" ? addEvent : undefined}
              addLabel="New event"
            />
            {g.events.map((ev) => (
              <EventRow key={ev.id} ev={ev} meta={eventMeta(ev, g.key)} onMenu={eventMenu} />
            ))}
          </div>
        ))}
      {empty && (
        <SidebarEmpty
          testId="agenda-empty"
          icon="calendar"
          title="No events yet"
          description="Today is free — add an event to plan it."
          action="New event"
          onAction={addEvent}
        />
      )}
      <ContextMenu menu={cm.menu} />
    </ScrollArea>
  );
}
