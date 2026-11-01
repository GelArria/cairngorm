// Pure grouping/formatting for the Agenda sidebar (unit-testable).
import type { CalendarEvent } from "@/calendar/model/types";

export type AgendaKey = "today" | "tomorrow" | "upcoming";
export interface AgendaGroup {
  key: AgendaKey;
  label: string;
  events: CalendarEvent[];
}

const UPCOMING_DAYS = 7; // after tomorrow

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const covers = (ev: CalendarEvent, day: string) => ev.date <= day && (ev.endDate ?? ev.date) >= day;

export function groupAgenda(events: CalendarEvent[], now: Date): AgendaGroup[] {
  const today = isoDay(now);
  const tomorrow = isoDay(addDays(now, 1));
  const last = isoDay(addDays(now, 1 + UPCOMING_DAYS));
  const order = (a: CalendarEvent, b: CalendarEvent) =>
    a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  const todayEv = events.filter((e) => covers(e, today)).sort(order);
  const tomorrowEv = events.filter((e) => covers(e, tomorrow) && !todayEv.includes(e)).sort(order);
  const upcoming = events.filter((e) => e.date > tomorrow && e.date <= last).sort(order);
  const label = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return [
    { key: "today" as const, label: `Today · ${label}`, events: todayEv },
    { key: "tomorrow" as const, label: "Tomorrow", events: tomorrowEv },
    { key: "upcoming" as const, label: "Upcoming", events: upcoming },
  ].filter((g) => g.events.length > 0 || g.key === "today");
}

/** Right-hand meta: time today/tomorrow; "Mon 5 · 10:00", "Oct 6–8" or "Fri 9" upcoming. */
export function eventMeta(ev: CalendarEvent, key: AgendaKey): string {
  const time = ev.time;
  if (key !== "upcoming") {
    return time;
  }
  const start = parse(ev.date);
  if (ev.endDate && ev.endDate !== ev.date) {
    const end = parse(ev.endDate);
    const mon = start.toLocaleDateString("en-US", { month: "short" });
    return start.getMonth() === end.getMonth()
      ? `${mon} ${start.getDate()}–${end.getDate()}`
      : `${mon} ${start.getDate()}–${end.toLocaleDateString("en-US", { month: "short" })} ${end.getDate()}`;
  }
  const day = `${start.toLocaleDateString("en-US", { weekday: "short" })} ${start.getDate()}`;
  return time ? `${day} · ${time}` : day;
}
