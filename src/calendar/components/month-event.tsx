// One event inside a month cell (Doop "Agenda"): colour dot + time + title.
import { EmptyState } from "@/common/components/empty-state";
import type { CalendarEvent } from "../model/types";

interface Props {
  compact?: boolean;
  event: CalendarEvent;
  onEdit: (ev: CalendarEvent) => void;
  onMenu?: (e: MouseEvent, ev: CalendarEvent) => void;
}

export function MonthEventList({
  events,
  onEdit,
  onMenu,
}: {
  events: CalendarEvent[];
  onEdit: Props["onEdit"];
  onMenu: Props["onMenu"];
}) {
  return (
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border px-2 py-2"
      aria-label="Month events"
      role="region"
    >
      {events.length === 0 && <EmptyState icon="calendar" text="No events this month" />}
      {events.map((event) => (
        <div key={event.id} class="mb-2 min-w-0">
          <time dateTime={event.date} class="px-1 text-[10px] text-muted-foreground">
            {event.date}
          </time>
          <MonthEvent event={event} onEdit={onEdit} onMenu={onMenu} />
        </div>
      ))}
    </div>
  );
}

export function MonthEvent({ event, onEdit, onMenu, compact = false }: Props) {
  return (
    <div class="shrink-0">
      <button
        type="button"
        aria-label={`${event.time ? `${event.time} ` : ""}${event.title}`}
        title={`${event.time ? `${event.time} · ` : ""}${event.title}`}
        class={`flex h-[19px] w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-none text-foreground transition-colors hover:bg-accent/60 ${compact ? "justify-center" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(event);
        }}
        onContextMenu={(e) => onMenu?.(e, event)}
      >
        <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${event.color}`} />
        {!compact && event.time && (
          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">{event.time}</span>
        )}
        {!compact && <span class="truncate leading-4">{event.title}</span>}
      </button>
    </div>
  );
}
