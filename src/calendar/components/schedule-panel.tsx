import { useSchedulePanel } from "@/calendar/hooks/use-schedule-panel";
import { EmptyState } from "@/common/components/empty-state";
import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Dialog } from "@/common/ui/dialog";
import { Icon } from "@/common/ui/icon";
import { requestScheduleForm } from "../data/scheduled-tasks";
import { RunChanges } from "./run-changes";
import { ScheduledTaskRow } from "./scheduled-task-row";

export function SchedulePanel({ projectId }: { projectId: string | null }) {
  const { data, removing, setRemoving, setResultId, busy, error, setError, tasks, result, act } =
    useSchedulePanel({ projectId });

  return (
    <>
      <div class="flex min-h-0 flex-1 flex-col" data-testid="schedule-panel">
        <div class="space-y-3 border-b border-border px-3 py-3">
          <div>
            <h2 class="text-sm font-semibold">Scheduled tasks</h2>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Give an agent a task. Choose when it runs.
            </p>
          </div>
          <Button
            size="sm"
            class="w-full gap-1.5"
            onClick={() => requestScheduleForm(null, projectId)}
            disabled={!projectId || data.loading || !!data.error}
          >
            <Icon name="plus" />
            Schedule event
          </Button>
        </div>
        {(error || data.error) && (
          <div class="px-3 py-2">
            <InlineNotice
              message={error || data.error}
              onDismiss={() => {
                setError("");
                data.clearError();
              }}
            />
          </div>
        )}
        <div
          class="flex min-h-0 flex-1 flex-col overflow-y-auto"
          role="region"
          aria-label="Scheduled tasks"
        >
          {data.loading ? (
            <p class="px-3 py-4 text-xs text-muted-foreground">Loading schedules…</p>
          ) : tasks.length === 0 && !data.error ? (
            <EmptyState
              icon="clock-counter-clockwise"
              text="No scheduled tasks"
              description="Schedule a one-time task or a repeating prompt for this project."
            />
          ) : null}
          {tasks.map((task) => (
            <ScheduledTaskRow
              key={task.id}
              task={task}
              busy={busy}
              onEdit={() => requestScheduleForm(task, projectId)}
              onAction={(action) =>
                action === "delete" ? setRemoving(task) : void act(task, action)
              }
              onResult={() => setResultId(task.id)}
            />
          ))}
        </div>
        <p class="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Runs locally while Cairngorm is open. Configured agent permissions apply.
        </p>
      </div>
      {removing && (
        <ConfirmDialog
          open
          title="Delete scheduled task?"
          message={`Delete “${removing.title}” and its last result? This cannot be undone.`}
          confirmLabel="Delete task"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            if (!busy) {
              void act(removing, "delete");
            }
          }}
        />
      )}
      {result && (
        <Dialog
          open
          title="Last run result"
          description={`${result.title} · ${result.status}`}
          onClose={() => setResultId(null)}
        >
          <div class="space-y-3 px-5 py-4">
            <p class="text-xs text-muted-foreground">
              {result.lastRun ? new Date(result.lastRun * 1000).toLocaleString() : "Not run yet"}
            </p>
            <pre class="whitespace-pre-wrap break-words font-sans text-sm">
              {result.output ||
                (result.status === "running"
                  ? "The agent is still running. The final result will appear here."
                  : "No text was returned.")}
            </pre>
            {result.status !== "running" && result.lastRun !== null && (
              <RunChanges changes={result.changes} />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
