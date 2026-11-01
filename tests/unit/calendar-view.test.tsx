import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/preact";
import type { CalendarEvent } from "@/calendar/model/types";

const { mockEvents, loadEventsForMonthMock, addEventMock, updateEventMock, deleteEventMock } =
  vi.hoisted(() => {
    const mockEvents: CalendarEvent[] = [];
    return {
      mockEvents,
      loadEventsForMonthMock: vi.fn(
        async (_projectId: string | null, _year: number, _month: number) => mockEvents,
      ),
      addEventMock: vi.fn(),
      updateEventMock: vi.fn(),
      deleteEventMock: vi.fn(),
    };
  });

vi.mock("@/calendar/data/calendar-db", () => ({
  loadEventsForMonth: loadEventsForMonthMock,
  addEvent: addEventMock,
  updateEvent: updateEventMock,
  deleteEvent: deleteEventMock,
}));

function setMockEvents(next: CalendarEvent[]) {
  mockEvents.length = 0;
  mockEvents.push(...next);
}

import { EventCalendar as CalendarView } from "@/calendar/components/event-calendar";

describe("EventCalendar", () => {
  beforeEach(() => {
    setMockEvents([]);
    loadEventsForMonthMock.mockClear();
    addEventMock.mockClear();
    updateEventMock.mockClear();
    deleteEventMock.mockClear();
  });

  it("renders the current month header", async () => {
    const { getByText } = render(<CalendarView projectId="calendar-project" />);
    await waitFor(() => expect(loadEventsForMonthMock).toHaveBeenCalled());
    const now = new Date();
    const monthRe = new RegExp(now.toLocaleString("en-US", { month: "long" }));
    expect(getByText(monthRe)).toBeTruthy();
  });

  it("reloads events for the project supplied by its caller", async () => {
    const { rerender } = render(<CalendarView projectId="one" />);
    await waitFor(() =>
      expect(loadEventsForMonthMock).toHaveBeenCalledWith(
        "one",
        expect.any(Number),
        expect.any(Number),
      ),
    );
    rerender(<CalendarView projectId="two" />);
    await waitFor(() =>
      expect(loadEventsForMonthMock).toHaveBeenCalledWith(
        "two",
        expect.any(Number),
        expect.any(Number),
      ),
    );
  });

  it("navigates months with prev/next buttons", async () => {
    const { getByLabelText, getByText } = render(<CalendarView projectId="calendar-project" />);
    await waitFor(() => expect(loadEventsForMonthMock).toHaveBeenCalled());
    const nextBtn = getByLabelText("Next month");
    fireEvent.click(nextBtn);
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthRe = new RegExp(nextMonth.toLocaleString("en-US", { month: "long" }));
    await waitFor(() => expect(getByText(monthRe)).toBeTruthy());
  });

  it("today button returns to current month after navigation", async () => {
    const { getByLabelText, getByText } = render(<CalendarView projectId="calendar-project" />);
    await waitFor(() => expect(loadEventsForMonthMock).toHaveBeenCalled());
    fireEvent.click(getByLabelText("Next month"));
    fireEvent.click(getByLabelText("Today"));
    const now = new Date();
    const monthRe = new RegExp(now.toLocaleString("en-US", { month: "long" }));
    await waitFor(() => expect(getByText(monthRe)).toBeTruthy());
  });
});
