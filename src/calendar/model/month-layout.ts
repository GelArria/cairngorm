// Month grid layout (pure): the 5–6 week rows of a month and, per week, the
// multi-day bars packed into lanes so overlapping ranges stack instead of collide.
import { dateStr, daysInMonth, firstDayOfMonth } from "./date-utils";
import type { CalendarEvent } from "./types";

export interface DayCell {
  day: number;
  date: string;
  isToday: boolean;
  isOtherMonth: boolean;
}

export interface WeekBar {
  event: CalendarEvent;
  /** 1-based grid columns, end exclusive */
  colStart: number;
  colEnd: number;
  /** 0-based stacking row */
  lane: number;
}

export interface Week {
  cells: DayCell[];
  bars: WeekBar[];
  /** per column: lanes a bar occupies above that day (reserve space under the number) */
  lanesAt: number[];
}

export function isMultiDayEvent(ev: CalendarEvent): boolean {
  return !!ev.endDate && ev.endDate > ev.date;
}

/** Monday-first cells for `month`, padded with the neighbouring months' days. */
export function buildMonthCells(
  year: number,
  month: number,
  today: { year: number; month: number; day: number },
): DayCell[] {
  const count = daysInMonth(year, month);
  const offset = firstDayOfMonth(year, month);
  const total = Math.ceil((count + offset) / 7) * 7;
  const prevMonth = month === 0 ? 11 : month - 1,
    prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1,
    nextYear = month === 11 ? year + 1 : year;
  const prevDays = daysInMonth(prevYear, prevMonth);
  const isCurrent = today.year === year && today.month === month;
  const cells: DayCell[] = [];
  for (let i = 0; i < total; i++) {
    const day = i - offset + 1;
    if (day < 1) {
      const d = prevDays + day;
      cells.push({
        day: d,
        date: dateStr(prevYear, prevMonth, d),
        isToday: false,
        isOtherMonth: true,
      });
    } else if (day > count) {
      const d = day - count;
      cells.push({
        day: d,
        date: dateStr(nextYear, nextMonth, d),
        isToday: false,
        isOtherMonth: true,
      });
    } else {
      cells.push({
        day,
        date: dateStr(year, month, day),
        isToday: isCurrent && day === today.day,
        isOtherMonth: false,
      });
    }
  }
  return cells;
}

export function layoutWeeks(cells: DayCell[], events: CalendarEvent[]): Week[] {
  // Earlier start first; on a tie the longer range takes the upper lane
  const ranges = events
    .filter(isMultiDayEvent)
    .sort((a, b) => a.date.localeCompare(b.date) || b.endDate!.localeCompare(a.endDate!));
  const weeks: Week[] = [];
  for (let w = 0; w < cells.length; w += 7) {
    const days = cells.slice(w, w + 7);
    const lanes: boolean[][] = [];
    const bars: WeekBar[] = [];
    for (const ev of ranges) {
      let start = -1,
        end = -1;
      days.forEach((c, i) => {
        if (c.date >= ev.date && c.date <= ev.endDate!) {
          if (start < 0) {
            start = i;
          }
          end = i;
        }
      });
      if (start < 0) {
        continue;
      }
      let lane = 0;
      while (lanes[lane]?.slice(start, end + 1).some(Boolean)) {
        lane++;
      }
      lanes[lane] ??= Array(7).fill(false);
      for (let i = start; i <= end; i++) {
        lanes[lane][i] = true;
      }
      bars.push({ event: ev, colStart: start + 1, colEnd: end + 2, lane });
    }
    const lanesAt = days.map((_, i) => lanes.reduce((n, l, k) => (l[i] ? k + 1 : n), 0));
    weeks.push({ cells: days, bars, lanesAt });
  }
  return weeks;
}
