import { useEventCalendar } from "@/calendar/hooks/use-event-calendar";
import { ContextMenu } from "@/common/components/context-menu";
import { lazy, Suspense } from "preact/compat";
import { dateStr } from "../model/date-utils";
import { EventCalendarHeader } from "./event-calendar-header";
import { MonthEventList } from "./month-event";
import { MonthGrid } from "./month-grid";

const LazyEventFormModal = lazy(() =>
  import("./event-form-modal").then((m) => ({ default: m.EventFormModal })),
);

export function EventCalendar({
  projectId,
  compact = false,
}: {
  projectId: string | null;
  compact?: boolean;
}) {
  const {
    t,
    viewYear,
    viewMonth,
    data,
    events,
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
  } = useEventCalendar({ projectId });

  return (
    <>
      <div data-testid="event-calendar" class="flex h-full min-h-0 flex-col overflow-auto">
        <EventCalendarHeader
          compact={compact}
          month={viewMonth}
          year={viewYear}
          current={isCurrentMonth}
          loading={showLoading}
          error={error}
          onPrevious={navPrev}
          onNext={navNext}
          onToday={navToday}
          onAdd={() => openAdd(dateStr(t.year, t.month, t.day))}
          onClearError={data.clearError}
        />
        <MonthGrid
          compact={compact}
          weeks={weeks}
          eventsByDate={eventsByDate}
          onAdd={openAdd}
          onEdit={openEdit}
          onDayMenu={dayMenu}
          onEventMenu={eventMenu}
        />
        {compact && <MonthEventList events={events} onEdit={openEdit} onMenu={eventMenu} />}
      </div>

      <ContextMenu menu={cm.menu} />
      {form && (
        <Suspense fallback={null}>
          <LazyEventFormModal
            form={form}
            setForm={setForm}
            onDelete={handleDelete}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
          />
        </Suspense>
      )}
    </>
  );
}
