import { scheduleLabel, type ScheduledTaskInput } from "../data/scheduled-tasks";
import { AGENT_LABELS } from "./schedule-target-fields";

export function ScheduleReview({
  input,
  consent,
  onConsent,
}: {
  input: ScheduledTaskInput;
  consent: boolean;
  onConsent: (value: boolean) => void;
}) {
  return (
    <>
      <h3 class="break-words text-sm font-medium">{input.title}</h3>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt class="text-muted-foreground">Project</dt>
        <dd class="break-words">{input.projectName}</dd>
        <dt class="text-muted-foreground">Folder</dt>
        <dd class="break-all">{input.rootPath}</dd>
        <dt class="text-muted-foreground">Agent</dt>
        <dd>{AGENT_LABELS[input.agent]} · configured model</dd>
        <dt class="text-muted-foreground">Schedule</dt>
        <dd>{scheduleLabel(input)}</dd>
        {input.intervalMinutes && (
          <>
            <dt class="text-muted-foreground">First run</dt>
            <dd>{new Date(input.nextAt * 1000).toLocaleString()}</dd>
          </>
        )}
      </dl>
      <div class="border-y border-border py-3">
        <p class="mb-2 text-xs text-muted-foreground">Instructions</p>
        <p class="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{input.prompt}</p>
      </div>
      <label class="flex items-start gap-2 text-xs leading-relaxed">
        <input
          type="checkbox"
          class="mt-0.5"
          checked={consent}
          onChange={(e) => onConsent(e.currentTarget.checked)}
        />
        Allow unattended execution in this project. The agent may modify files using its configured
        permissions. Cairngorm must stay open.
      </label>
    </>
  );
}
