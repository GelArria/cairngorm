import { Button } from "@/common/ui/button";
import { scheduleLabel, type ScheduledTask } from "../data/scheduled-tasks";
import { AGENT_LABELS } from "./schedule-target-fields";

export function ScheduledTaskRow({
  task,
  busy,
  onEdit,
  onAction,
  onResult,
}: {
  task: ScheduledTask;
  busy: boolean;
  onEdit: () => void;
  onAction: (action: "pause" | "resume" | "run" | "delete") => void;
  onResult: () => void;
}) {
  const running = task.status === "running";
  const needsNewTime =
    !task.enabled &&
    !task.requested &&
    task.intervalMinutes === null &&
    task.nextAt <= Date.now() / 1000;
  const state = task.requested
    ? "Queued"
    : running
      ? "Running"
      : !task.enabled && task.status === "scheduled"
        ? "Paused"
        : task.status === "scheduled"
          ? "Scheduled"
          : task.status[0].toUpperCase() + task.status.slice(1);
  return (
    <article aria-label={task.title} class="space-y-2 border-b border-border px-3 py-3">
      <div class="flex items-start gap-2">
        <h3 class="min-w-0 flex-1 break-words text-sm font-medium">{task.title}</h3>
        <span
          class={`shrink-0 text-[11px] ${task.status === "failed" || task.status === "interrupted" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {state}
        </span>
      </div>
      <p class="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {task.prompt}
      </p>
      <p class="text-[11px] text-muted-foreground">
        {AGENT_LABELS[task.agent]} · {scheduleLabel(task)}
      </p>
      <p class="text-[11px] text-muted-foreground">
        {task.enabled
          ? `Next: ${new Date(task.nextAt * 1000).toLocaleString()}`
          : task.intervalMinutes
            ? "Schedule paused"
            : "One-time schedule inactive"}
      </p>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          disabled={busy || running || task.requested}
          onClick={() => onAction("run")}
        >
          Run now
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || running} onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={busy || (running && !task.enabled)}
          onClick={() =>
            needsNewTime ? onEdit() : onAction(task.enabled || task.requested ? "pause" : "resume")
          }
        >
          {needsNewTime ? "Schedule again" : task.enabled || task.requested ? "Pause" : "Resume"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={busy || running}
          onClick={() => onAction("delete")}
        >
          Delete
        </Button>
        {task.lastRun !== null && (
          <Button variant="ghost" size="xs" onClick={onResult}>
            Last result
          </Button>
        )}
      </div>
    </article>
  );
}
