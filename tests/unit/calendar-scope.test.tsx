import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/calendar/model/types";

const db = vi.hoisted(() => ({ load: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/calendar/data/calendar-db", () => ({
  loadEventsForMonth: db.load,
  addEvent: db.add,
  updateEvent: db.update,
  deleteEvent: db.remove,
}));
import { useCalendarEvents } from "@/calendar/hooks/use-calendar-events";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const event: CalendarEvent = {
  id: "old",
  title: "Old project",
  date: "2026-06-01",
  time: "09:00",
  duration: 30,
  color: "blue",
};

it("ignores a late read from the previous project", async () => {
  let resolve!: (rows: CalendarEvent[]) => void;
  db.load
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue([]);
  const hook = renderHook(({ id }) => useCalendarEvents(id, 2026, 5), {
    initialProps: { id: "one" },
  });
  await waitFor(() => expect(db.load).toHaveBeenCalledWith("one", 2026, 5));
  hook.rerender({ id: "two" });
  await waitFor(() => expect(db.load).toHaveBeenCalledWith("two", 2026, 5));
  await act(async () => {
    resolve([event]);
  });
  expect(hook.result.current.events).toEqual([]);
});

it("writes to the captured project without adding its late result to the new view", async () => {
  db.load.mockResolvedValue([]);
  let resolve!: (id: string) => void;
  db.add.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const hook = renderHook(({ id }) => useCalendarEvents(id, 2026, 5), {
    initialProps: { id: "one" },
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const { id: _id, ...input } = event;
  const pending = hook.result.current.add(input);
  expect(db.add).toHaveBeenCalledWith("one", input);
  hook.rerender({ id: "two" });
  await waitFor(() => expect(db.load).toHaveBeenCalledWith("two", 2026, 5));
  await act(async () => {
    resolve("created");
    expect(await pending).toBe(false);
  });
  expect(hook.result.current.events).toEqual([]);
});
