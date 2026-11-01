import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

const { tables, selectMock, executeMock } = vi.hoisted(() => {
  const tables = new Map<string, Row[]>();
  function cloneTables(): Map<string, Row[]> {
    const m = new Map<string, Row[]>();
    for (const [k, v] of tables.entries())
      m.set(
        k,
        v.map((r) => ({ ...r })),
      );
    return m;
  }
  const selectMock = vi.fn(async <T>(query: string, values: unknown[] = []): Promise<T[]> => {
    const snap = cloneTables();
    if (/FROM\s+calendar_events/i.test(query)) {
      let rows = snap.get("calendar_events") ?? [];
      if (/WHERE\s+project_id\s+IS\s+\?/i.test(query))
        rows = rows.filter((r) => r.project_id === values[0]);
      if (/AND\s+date\s*<=\s*\?\s+AND\s+COALESCE\(end_date,\s*date\)\s*>=\s*\?/i.test(query)) {
        const monthEnd = String(values[1]);
        const monthStart = String(values[2]);
        return rows.filter((r) => {
          const date = String(r.date);
          const end = r.end_date ? String(r.end_date) : date;
          return date <= monthEnd && end >= monthStart;
        }) as T[];
      }
      if (/WHERE\s+id\s*=\s*\?/i.test(query)) {
        return rows.filter((r) => String(r.id) === String(values[0])) as T[];
      }
      return rows as T[];
    }
    return [];
  });
  const executeMock = vi.fn(async (query: string, values: unknown[] = []): Promise<void> => {
    const q = query.trim();
    const insertMatch = q.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const [, table, colsRaw] = insertMatch;
      const cols = colsRaw.split(",").map((c) => c.trim());
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i];
      const arr = tables.get(table) ?? [];
      arr.push(row);
      tables.set(table, arr);
      return;
    }
    const updateMatch = q.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (updateMatch) {
      const [, table, setRaw, whereRaw] = updateMatch;
      const arr = tables.get(table) ?? [];
      const setClauses = setRaw
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /\w+\s*=\s*\?/.test(c));
      for (const row of arr) {
        if (whereRaw && /\w+\s*=\s*\?/.test(whereRaw)) {
          const cond = whereRaw.match(/(\w+)\s*=\s*\?/);
          if (cond && String(row[cond[1]]) !== String(values[values.length - 1])) continue;
        }
        let local = 0;
        for (const clause of setClauses) {
          const m = clause.match(/(\w+)\s*=\s*\?/);
          if (m && row[m[1]] !== undefined) {
            row[m[1]] = values[local];
          }
          if (m) local++;
        }
      }
      tables.set(table, arr);
      return;
    }
    const deleteMatch = q.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
    if (deleteMatch) {
      const [, table, whereRaw] = deleteMatch;
      if (!whereRaw) {
        tables.set(table, []);
        return;
      }
      const cond = whereRaw.match(/(\w+)\s*=\s*\?/);
      if (cond) {
        const arr = tables.get(table) ?? [];
        tables.set(
          table,
          arr.filter((r) => String(r[cond[1]]) !== String(values[0])),
        );
      }
    }
  });
  return { tables, selectMock, executeMock };
});

vi.mock("@/common/storage/db", () => ({
  select: selectMock,
  execute: executeMock,
}));

let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => {
    uuidCounter += 1;
    return `uuid-${uuidCounter}`;
  },
});

import {
  loadEvents,
  loadEventsForMonth,
  addEvent,
  updateEvent,
  deleteEvent,
  timeFromEndTimes,
} from "@/calendar/data/calendar-db";

function resetTables() {
  tables.clear();
  tables.set("calendar_events", []);
  selectMock.mockClear();
  executeMock.mockClear();
  uuidCounter = 0;
}

function seedEvent(overrides: Partial<Row> = {}): Row {
  const id = `event-${(tables.get("calendar_events")?.length ?? 0) + 1}`;
  const row: Row = {
    id,
    title: "Meeting",
    date: "2026-06-15",
    end_date: null,
    start_time: "09:00",
    end_time: "09:30",
    color: "bg-blue-500",
    description: "",
    created_at: "2026-06-15 00:00:00",
    updated_at: "2026-06-15 00:00:00",
    project_id: "calendar-project",
    ...overrides,
  };
  const arr = tables.get("calendar_events") ?? [];
  arr.push(row);
  tables.set("calendar_events", arr);
  return row;
}

describe("calendar-db — SQLite persistence (mocked)", () => {
  beforeEach(() => resetTables());

  it("loadEvents returns all rows mapped to CalendarEvent", async () => {
    seedEvent({ title: "Daily standup", description: "team sync" });
    const events = await loadEvents("calendar-project");
    expect(events.length).toBe(1);
    expect(events[0].title).toBe("Daily standup");
    expect(events[0].description).toBe("team sync");
    expect(events[0].duration).toBe(30);
  });

  it("lists only the caller-selected project events, including month queries", async () => {
    seedEvent({ id: "active" });
    seedEvent({ id: "other", project_id: "other-project" });
    seedEvent({ id: "orphan", project_id: null });
    expect((await loadEvents("other-project")).map((e) => e.id)).toEqual(["other"]);
    expect((await loadEvents(null)).map((e) => e.id)).toEqual(["orphan"]);
    expect((await loadEvents("calendar-project")).map((e) => e.id)).toEqual(["active"]);
    expect((await loadEventsForMonth("calendar-project", 2026, 5)).map((e) => e.id)).toEqual([
      "active",
    ]);
  });

  it("loadEventsForMonth includes events whose date range overlaps the month", async () => {
    seedEvent({ date: "2026-05-30", end_date: null });
    seedEvent({ date: "2026-06-10", end_date: "2026-06-12" });
    seedEvent({ date: "2026-05-28", end_date: "2026-06-02" });
    seedEvent({ date: "2026-07-01", end_date: null });
    const events = await loadEventsForMonth("calendar-project", 2026, 5);
    expect(events.map((e) => e.date)).toEqual(["2026-06-10", "2026-05-28"]);
  });

  it("addEvent inserts row with computed end_time", async () => {
    const id = await addEvent("calendar-project", {
      title: "Review",
      time: "14:00",
      duration: 60,
      date: "2026-06-18",
      color: "bg-rose-500",
      description: "code review",
    });
    const row = tables.get("calendar_events")!.find((r) => r.id === id);
    expect(row?.project_id).toBe("calendar-project");
    expect(row?.title).toBe("Review");
    expect(row?.start_time).toBe("14:00");
    expect(row?.end_time).toBe("15:00");
    expect(row?.description).toBe("code review");
  });

  it("updateEvent patches fields and recomputes end_time", async () => {
    seedEvent({ id: "ev-1", title: "Old", start_time: "10:00", end_time: "10:30" });
    await updateEvent("ev-1", { title: "New", duration: 90 });
    const row = tables.get("calendar_events")!.find((r) => r.id === "ev-1")!;
    expect(row.title).toBe("New");
    expect(row.end_time).toBe("11:30");
  });

  it("deleteEvent removes row", async () => {
    seedEvent({ id: "ev-del" });
    await deleteEvent("ev-del");
    expect(tables.get("calendar_events")!.find((r) => r.id === "ev-del")).toBeUndefined();
  });

  it("timeFromEndTimes handles same-day and overnight ranges", () => {
    expect(timeFromEndTimes("09:00", "09:30")).toBe(30);
    expect(timeFromEndTimes("23:00", "01:00")).toBe(120);
  });

  it("addEvent stores end_date for multi-day events", async () => {
    const id = await addEvent("calendar-project", {
      title: "Offsite",
      time: "09:00",
      duration: 30,
      date: "2026-06-20",
      endDate: "2026-06-22",
      color: "bg-emerald-500",
    });
    const row = tables.get("calendar_events")!.find((r) => r.id === id);
    expect(row?.end_date).toBe("2026-06-22");
  });

  it("loadEventsForMonth excludes events outside the queried month", async () => {
    seedEvent({ date: "2026-04-01" });
    const events = await loadEventsForMonth("calendar-project", 2026, 5);
    expect(events.length).toBe(0);
  });
});
