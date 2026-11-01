// Month grid (Doop "Agenda"): weekday legend, then week rows that share the
// height in a rounded hairline grid. Today = filled number circle; other-month
// days are dimmed; multi-day events are solid bars laid over the week. Rows
// share the height when it fits and grow past it (the view scrolls) so no
// event is ever clipped.
import { DAYS } from "../model/constants";
import type { Week } from "../model/month-layout";
import type { CalendarEvent } from "../model/types";
import { MonthEvent } from "./month-event";

/** Bar row height; cells reserve lanes × LANE + 3 px under the day number. */
const LANE = 19;

interface Props {
  compact?: boolean;
  weeks: Week[];
  eventsByDate: Record<string, CalendarEvent[]>;
  onAdd: (date: string) => void;
  onEdit: (ev: CalendarEvent) => void;
  onDayMenu?: (e: MouseEvent, date: string) => void;
  onEventMenu?: (e: MouseEvent, ev: CalendarEvent) => void;
}

export function MonthGrid({
  compact = false,
  weeks,
  eventsByDate,
  onAdd,
  onEdit,
  onDayMenu,
  onEventMenu,
}: Props) {
  return (
    <div
      class={`flex min-h-0 min-w-0 flex-col overflow-auto px-2 pb-4 ${compact ? "shrink-0" : "flex-1 sm:px-4"}`}
      role="region"
      aria-label="Monthly calendar"
      tabIndex={0}
    >
      <div class={`flex flex-[1_0_auto] flex-col ${compact ? "min-w-0" : "min-w-[560px]"}`}>
        <div class="grid shrink-0 grid-cols-7 pb-1.5">
          {DAYS.map((name, i) => (
            <span
              key={name}
              class={`pl-[7px] text-[11px] font-medium ${i >= 5 ? "text-muted-foreground/50" : "text-muted-foreground"}`}
            >
              {compact ? name.slice(0, 1) : name}
            </span>
          ))}
        </div>
        <div class="flex flex-[1_0_auto] flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
          {weeks.map((week) => (
            <div
              key={week.cells[0].date}
              class={`relative grid flex-[1_0_auto] grid-cols-7 gap-px ${compact ? "min-h-[56px]" : "min-h-[72px]"}`}
            >
              {week.cells.map((cell, i) => (
                <div
                  key={cell.date}
                  class={`flex min-w-0 flex-col gap-[3px] overflow-hidden ${compact ? "px-0.5" : "px-1.5"} py-[5px] ${
                    cell.isOtherMonth
                      ? "bg-card"
                      : "cursor-pointer bg-background transition-colors hover:bg-secondary"
                  }`}
                  onClick={() => !cell.isOtherMonth && onAdd(cell.date)}
                  onContextMenu={(e) => !cell.isOtherMonth && onDayMenu?.(e, cell.date)}
                >
                  <button
                    type="button"
                    disabled={cell.isOtherMonth}
                    aria-label={`New event on ${cell.date}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(cell.date);
                    }}
                    class={`flex h-5 shrink-0 items-center text-[11px] font-medium tabular-nums ${
                      cell.isToday
                        ? "w-5 justify-center rounded-full bg-foreground font-semibold text-background"
                        : cell.isOtherMonth
                          ? "text-muted-foreground/30"
                          : "text-muted-foreground"
                    }`}
                  >
                    {cell.day}
                  </button>
                  {week.lanesAt[i] > 0 && (
                    <div class="shrink-0" style={{ height: week.lanesAt[i] * LANE + 3 }} />
                  )}
                  {!cell.isOtherMonth &&
                    (eventsByDate[cell.date] ?? []).map((ev) => (
                      <MonthEvent
                        key={ev.id}
                        event={ev}
                        onEdit={onEdit}
                        onMenu={onEventMenu}
                        compact={compact}
                      />
                    ))}
                </div>
              ))}
              {week.bars.length > 0 && (
                <div
                  class="pointer-events-none absolute inset-0 grid grid-cols-7 content-start gap-x-px pt-[25px]"
                  style={{ gridAutoRows: `${LANE}px` }}
                >
                  {week.bars.map((bar) => (
                    <button
                      type="button"
                      key={`${bar.event.id}-${bar.colStart}`}
                      style={{
                        gridColumn: `${bar.colStart} / ${bar.colEnd}`,
                        gridRow: bar.lane + 1,
                      }}
                      class={`pointer-events-auto mx-1 flex h-[19px] min-w-0 items-center rounded px-[7px] text-left text-[10px] font-medium leading-4 text-[#0a0a0a] ${bar.event.color}`}
                      onClick={() => onEdit(bar.event)}
                      onContextMenu={(e) => onEventMenu?.(e, bar.event)}
                    >
                      <span class="truncate">{bar.event.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
