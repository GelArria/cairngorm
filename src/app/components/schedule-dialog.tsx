import { SCHEDULE_EDIT_EVENT, type ScheduledTask } from "@/calendar/api";
import { openSidebarModule } from "@/common/events/app-events";
import { getActiveProject, switchProject, useProjects } from "@/projects/api";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

const ScheduleForm = lazy(() =>
  import("@/calendar/components/schedule-form").then((module) => ({
    default: module.ScheduleForm,
  })),
);

/** App-owned dialog survives sidebar reparenting at mobile breakpoints. */
export function ScheduleDialog() {
  const { projects } = useProjects();
  const [request, setRequest] = useState<{
    task: ScheduledTask | null;
    projectId: string | null;
  } | null>(null);
  useEffect(() => {
    const edit = (event: Event) => setRequest((event as CustomEvent).detail);
    const create = (event: Event) => {
      if ((event as CustomEvent).detail?.kind === "calendar-event") {
        setRequest({ task: null, projectId: getActiveProject()?.id ?? null });
      }
    };
    window.addEventListener(SCHEDULE_EDIT_EVENT, edit);
    window.addEventListener("app-create", create);
    return () => {
      window.removeEventListener(SCHEDULE_EDIT_EVENT, edit);
      window.removeEventListener("app-create", create);
    };
  }, []);
  return (
    request && (
      <Suspense fallback={null}>
        <ScheduleForm
          key={request.task?.id ?? "new"}
          task={request.task}
          projectId={request.projectId}
          projects={projects}
          onClose={() => setRequest(null)}
          onSaved={(projectId) => {
            switchProject(projectId);
            openSidebarModule("calendar");
          }}
        />
      </Suspense>
    )
  );
}
