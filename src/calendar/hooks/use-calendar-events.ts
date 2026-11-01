import { errorMessage } from "@/common/errors";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { addEvent, deleteEvent, loadEventsForMonth, updateEvent } from "../data/calendar-db";
import type { CalendarEvent } from "../model/types";

/** Keep late reads and writes from an old project/month out of the current view. */
export function useCalendarEvents(projectId: string | null, year: number, month: number) {
  const scope = useMemo(() => ({ projectId, year, month }), [projectId, year, month]);
  const current = useRef<typeof scope | null>(scope);
  current.current = scope;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    current.current = scope;
    let cancelled = false;
    const active = () => !cancelled && current.current === scope;
    setEvents([]);
    setLoading(true);
    setError(null);
    loadEventsForMonth(projectId, year, month)
      .then((rows) => {
        if (active()) {
          setEvents(rows);
        }
      })
      .catch((e) => {
        if (active()) {
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (active()) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      current.current = null;
    };
  }, [scope]);

  async function mutate(
    write: () => Promise<void>,
    apply: (prev: CalendarEvent[]) => CalendarEvent[],
  ) {
    try {
      await write();
      if (current.current === scope) {
        setEvents(apply);
      }
    } catch (e) {
      if (current.current === scope) {
        setError(errorMessage(e));
      }
    }
    return current.current === scope;
  }

  return {
    events,
    loading,
    error,
    clearError: () => setError(null),
    add: async (event: Omit<CalendarEvent, "id">) => {
      let id = "";
      return mutate(
        async () => {
          id = await addEvent(projectId, event);
        },
        (prev) => [...prev, { ...event, id }],
      );
    },
    update: (id: string, updates: Partial<Omit<CalendarEvent, "id">>) =>
      mutate(
        () => updateEvent(id, updates),
        (prev) => prev.map((event) => (event.id === id ? { ...event, ...updates } : event)),
      ),
    remove: (id: string) =>
      mutate(
        () => deleteEvent(id),
        (prev) => prev.filter((event) => event.id !== id),
      ),
  };
}
