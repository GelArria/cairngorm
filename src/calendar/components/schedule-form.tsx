import { useScheduleForm } from "@/calendar/hooks/use-schedule-form";
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { type ScheduledTask, type ScheduleProject } from "../data/scheduled-tasks";
import { ScheduleReview } from "./schedule-review";
import { ScheduleTargetFields } from "./schedule-target-fields";
import { ScheduleTimingFields } from "./schedule-timing-fields";

export function ScheduleForm({
  task,
  projectId: initialProject,
  projects,
  onClose,
  onSaved,
}: {
  task: ScheduledTask | null;
  projectId: string | null;
  projects: ScheduleProject[];
  onClose: () => void;
  onSaved: (projectId: string) => void;
}) {
  const {
    title,
    setTitle,
    prompt,
    setPrompt,
    projectId,
    setProjectId,
    agent,
    setAgent,
    start,
    setStart,
    interval,
    setInterval,
    reviewing,
    setReviewing,
    consent,
    setConsent,
    busy,
    error,
    input,
    submit,
  } = useScheduleForm({ task, projectId: initialProject, projects, onClose, onSaved });

  return (
    <Dialog
      open
      title={reviewing ? "Review schedule" : task ? "Edit scheduled task" : "Schedule event"}
      description={
        reviewing
          ? "Confirm the task before enabling automatic execution."
          : "Tell an agent what to do, where to work and when to start."
      }
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      class="max-w-xl"
    >
      <form class="space-y-4 px-5 py-4" onSubmit={submit}>
        {reviewing ? (
          <ScheduleReview input={input} consent={consent} onConsent={setConsent} />
        ) : (
          <>
            <div>
              <Label for="schedule-title">Task name</Label>
              <Input
                id="schedule-title"
                required
                maxLength={200}
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="Review recent changes"
                autoFocus
              />
            </div>
            <div>
              <Label for="schedule-prompt">Instructions</Label>
              <Textarea
                id="schedule-prompt"
                required
                maxLength={20000}
                value={prompt}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                placeholder="Review changes in this project and summarize the risks. Do not commit or push."
                class="min-h-28 text-sm"
              />
            </div>
            <ScheduleTargetFields
              projects={projects}
              projectId={projectId}
              agent={agent}
              setProjectId={setProjectId}
              setAgent={setAgent}
            />
            <ScheduleTimingFields
              start={start}
              interval={interval}
              setStart={setStart}
              setInterval={setInterval}
            />
          </>
        )}
        {error && (
          <p role="alert" class="break-words text-xs text-destructive">
            {error}
          </p>
        )}
        <div class="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {reviewing && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setReviewing(false);
                setConsent(false);
              }}
            >
              Back
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || (reviewing && !consent)}>
            {busy ? "Saving…" : reviewing ? "Activate schedule" : "Review schedule"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
