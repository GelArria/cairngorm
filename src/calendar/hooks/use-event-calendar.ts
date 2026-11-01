import { useCalendarEvents } from "@/calendar/hooks/use-calendar-events";
import { emptyForm, today, toTimeInput } from "@/calendar/model/date-utils";
import { buildMonthCells, isMultiDayEvent, layoutWeeks } from "@/calendar/model/month-layout";
import type { CalendarEvent, EventFormState } from "@/calendar/model/types";
import { useLoaderGate } from "@/common/branding/";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups as menuGroups } from "@/common/model/context-menu";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

export function useEventCalendar({ projectId }: { projectId: string | null }) {
  const t = today();
  const [viewYear, setViewYear] = useState(t.year);
  const [viewMonth, setViewMonth] = useState(t.month);
  const data = useCalendarEvents(projectId, viewYear, viewMonth);
  const { events, loading, error } = data;
  const showLoading = useLoaderGate(loading);
  const [form, setForm] = useState<EventFormState | null>(null);

  useEffect(() => {
    setForm(null);
  }, [projectId]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (isMultiDayEvent(ev)) {
        continue;
      }
      (map[ev.date] ??= []).push(ev);
    }
    return map;
  }, [events]);

  const navPrev = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const navNext = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const navToday = useCallback(() => {
    const n = today();
    setViewYear(n.year);
    setViewMonth(n.month);
  }, []);

  const openAdd = useCallback((date: string) => {
    setForm(emptyForm(date));
  }, []);

  const openEdit = useCallback((ev: CalendarEvent) => {
    setForm({
      mode: "edit",
      date: ev.date,
      endDate: ev.endDate,
      eventId: ev.id,
      title: ev.title,
      time: toTimeInput(ev.time),
      duration: String(ev.duration),
      color: ev.color,
      description: ev.description,
    });
  }, []);

  const handleDelete = async (id: string) => {
    if (await data.remove(id)) {
      setForm(null);
    }
  };
  const handleAdd = async (event: Omit<CalendarEvent, "id">) => {
    if (await data.add(event)) {
      setForm(null);
    }
  };

  const cm = useContextMenu();
  const dayMenu = (e: MouseEvent, date: string) =>
    cm.open(
      e,
      menuGroups(
        [{ label: "New Event", action: () => openAdd(date) }],
        [{ label: "Go to Today", action: navToday, disabled: isCurrentMonth }],
      ),
    );
  const eventMenu = (e: MouseEvent, ev: CalendarEvent) =>
    cm.open(
      e,
      menuGroups(
        [
          { label: "Edit…", action: () => openEdit(ev) },
          {
            label: "Duplicate",
            action: () => {
              const { id: _id, ...copy } = ev;
              void handleAdd({ ...copy, title: `${ev.title} copy` });
            },
          },
        ],
        [
          {
            label: "Copy Title",
            action: () => void navigator.clipboard?.writeText(ev.title)?.catch(() => {}),
          },
        ],
        [{ label: "Delete", danger: true, action: () => void handleDelete(ev.id) }],
      ),
    );

  const handleUpdate = async (id: string, updates: Partial<Omit<CalendarEvent, "id">>) => {
    if (await data.update(id, updates)) {
      setForm(null);
    }
  };

  const isCurrentMonth = viewYear === t.year && viewMonth === t.month;

  const weeks = useMemo(
    () =>
      layoutWeeks(
        buildMonthCells(viewYear, viewMonth, { year: t.year, month: t.month, day: t.day }),
        events,
      ),
    [viewYear, viewMonth, events, t.year, t.month, t.day],
  );
  return {
    t,
    viewYear,
    viewMonth,
    data,
    events,
    loading,
    error,
    showLoading,
    form,
    setForm,
    eventsByDate,
    navPrev,
    navNext,
    navToday,
    openAdd,
    openEdit,
    handleDelete,
    handleAdd,
    cm,
    dayMenu,
    eventMenu,
    handleUpdate,
    isCurrentMonth,
    weeks,
  };
}
