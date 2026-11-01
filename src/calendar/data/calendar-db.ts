import { execute, select } from "@/common/storage/db";
import type { CalendarEvent } from "../model/types";

// Callers pass the project scope; NULL addresses events created before project initialization.

// Lets the Agenda sidebar refresh after the calendar view writes.
const notify = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("calendar-events-changed"));
  }
};

interface CalendarEventRow {
  id: string;
  title: string;
  date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  color: string;
  description: string;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return { hour: Number.isNaN(h) ? 0 : h, minute: Number.isNaN(m) ? 0 : m };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(time: string, durationMinutes: number): string {
  const { hour, minute } = parseTime(time);
  const total = hour * 60 + minute + durationMinutes;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return formatTime(nextHour, nextMinute);
}

export function timeFromEndTimes(startTime: string, endTime: string): number {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const startMins = start.hour * 60 + start.minute;
  const endMins = end.hour * 60 + end.minute;
  if (endMins >= startMins) {
    return endMins - startMins;
  }
  return endMins + 24 * 60 - startMins;
}

function rowToEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    endDate: row.end_date || undefined,
    time: row.start_time,
    duration: timeFromEndTimes(row.start_time, row.end_time),
    color: row.color,
    description: row.description || undefined,
  };
}

export async function loadEvents(projectId: string | null): Promise<CalendarEvent[]> {
  const rows = await select<CalendarEventRow>(
    `SELECT id, title, date, end_date, start_time, end_time, color, description
     FROM calendar_events
     WHERE project_id IS ?
     ORDER BY date ASC, start_time ASC`,
    [projectId],
  );
  return rows.map(rowToEvent);
}

export async function loadEventsForMonth(
  projectId: string | null,
  year: number,
  month: number,
): Promise<CalendarEvent[]> {
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = `${year}-${String(month + 1).padStart(2, "0")}-31`;
  const rows = await select<CalendarEventRow>(
    `SELECT id, title, date, end_date, start_time, end_time, color, description
     FROM calendar_events
     WHERE project_id IS ? AND date <= ? AND COALESCE(end_date, date) >= ?
     ORDER BY date ASC, start_time ASC`,
    [projectId, end, start],
  );
  return rows.map(rowToEvent);
}

export async function addEvent(
  projectId: string | null,
  event: Omit<CalendarEvent, "id">,
): Promise<string> {
  const id = crypto.randomUUID();
  const endTime = addMinutes(event.time, event.duration);
  const endDate = event.endDate && event.endDate > event.date ? event.endDate : null;
  await execute(
    `INSERT INTO calendar_events (id, title, date, end_date, start_time, end_time, color, description, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event.title,
      event.date,
      endDate,
      event.time,
      endTime,
      event.color,
      event.description || "",
      projectId,
    ],
  );
  notify();
  return id;
}

export async function updateEvent(
  eventId: string,
  updates: Partial<Omit<CalendarEvent, "id">>,
): Promise<void> {
  const existingRows = await select<CalendarEventRow>(
    "SELECT id, title, date, end_date, start_time, end_time, color, description FROM calendar_events WHERE id = ?",
    [eventId],
  );
  if (existingRows.length === 0) {
    return;
  }
  const existing = existingRows[0];

  const title = updates.title ?? existing.title;
  const date = updates.date ?? existing.date;
  const time = updates.time ?? existing.start_time;
  const duration = updates.duration ?? timeFromEndTimes(existing.start_time, existing.end_time);
  const color = updates.color ?? existing.color;
  const description = updates.description ?? existing.description;
  const endDate =
    updates.endDate !== undefined
      ? updates.endDate && updates.endDate > date
        ? updates.endDate
        : null
      : existing.end_date;
  const endTime = addMinutes(time, duration);

  await execute(
    `UPDATE calendar_events
     SET title = ?, date = ?, end_date = ?, start_time = ?, end_time = ?, color = ?, description = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [title, date, endDate, time, endTime, color, description || "", eventId],
  );
  notify();
}

export async function deleteEvent(eventId: string): Promise<void> {
  await execute("DELETE FROM calendar_events WHERE id = ?", [eventId]);
  notify();
}

/** App-owned project lifecycle calls this module's cleanup without knowing its tables. */
export async function deleteProjectEvents(projectId: string): Promise<void> {
  await execute("DELETE FROM calendar_events WHERE project_id = ?", [projectId]);
  notify();
}

export async function adoptUnassignedEvents(projectId: string): Promise<void> {
  await execute("UPDATE calendar_events SET project_id = ? WHERE project_id IS NULL", [projectId]);
  notify();
}
