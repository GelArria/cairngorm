import { describe, it, expect } from "vitest";
import { buildMonthCells, layoutWeeks } from "@/calendar/model/month-layout";
import type { CalendarEvent } from "@/calendar/model/types";

const ev = (id: string, date: string, endDate?: string): CalendarEvent => ({
  id,
  title: id,
  time: "10:00",
  duration: 30,
  date,
  endDate,
  color: "bg-blue-500",
});

describe("buildMonthCells", () => {
  it("pads October 2026 to Monday-first full weeks and marks today", () => {
    const cells = buildMonthCells(2026, 9, { year: 2026, month: 9, day: 1 });
    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 3).map((c) => [c.day, c.isOtherMonth])).toEqual([
      [28, true],
      [29, true],
      [30, true],
    ]);
    expect(cells[3]).toMatchObject({
      day: 1,
      date: "2026-10-01",
      isToday: true,
      isOtherMonth: false,
    });
    expect(cells[34]).toMatchObject({ day: 1, date: "2026-11-01", isOtherMonth: true });
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
  });

  it("marks no day as today outside the current month", () => {
    const cells = buildMonthCells(2026, 10, { year: 2026, month: 9, day: 1 });
    expect(cells.some((c) => c.isToday)).toBe(false);
  });
});

describe("layoutWeeks", () => {
  const cells = buildMonthCells(2026, 9, { year: 2026, month: 9, day: 1 });

  it("places a range inside one week as a single bar and reserves its lane", () => {
    const weeks = layoutWeeks(cells, [ev("migration", "2026-10-06", "2026-10-08")]);
    expect(weeks[1].bars).toEqual([expect.objectContaining({ colStart: 2, colEnd: 5, lane: 0 })]);
    expect(weeks[1].lanesAt).toEqual([0, 1, 1, 1, 0, 0, 0]);
    expect(weeks[0].bars).toHaveLength(0);
  });

  it("splits a range at week boundaries", () => {
    const weeks = layoutWeeks(cells, [ev("trip", "2026-10-10", "2026-10-13")]);
    expect(weeks[1].bars[0]).toMatchObject({ colStart: 6, colEnd: 8 });
    expect(weeks[2].bars[0]).toMatchObject({ colStart: 1, colEnd: 3 });
  });

  it("stacks overlapping ranges in separate lanes and ignores single-day events", () => {
    const weeks = layoutWeeks(cells, [
      ev("short", "2026-10-20", "2026-10-21"),
      ev("sprint", "2026-10-19", "2026-10-23"),
      ev("sync", "2026-10-20"),
    ]);
    const bars = weeks[3].bars.map((b) => [b.event.id, b.lane]);
    expect(bars).toEqual([
      ["sprint", 0],
      ["short", 1],
    ]);
    expect(weeks[3].lanesAt).toEqual([1, 2, 2, 1, 1, 0, 0]);
  });
});
