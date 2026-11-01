import {
  localDateTime,
  saveScheduledTask,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduleProject,
} from "@/calendar/data/scheduled-tasks";
import { errorMessage } from "@/common/errors";
import { useState } from "preact/hooks";

const MAX_TITLE = 200;
const MAX_PROMPT = 20000;
const MAX_INTERVAL_MINUTES = 525600;
const MAX_LEAD_SECONDS = 315360000;

function validate(input: ScheduledTaskInput, projectFound: boolean): string {
  if (!input.title) {
    return "Enter a task name.";
  }
  if (input.title.length > MAX_TITLE) {
    return `The task name is too long (${input.title.length}/${MAX_TITLE} characters).`;
  }
  if (!input.prompt) {
    return "Enter instructions telling the agent what to do.";
  }
  if (input.prompt.length > MAX_PROMPT) {
    return `The instructions are too long (${input.prompt.length}/${MAX_PROMPT} characters).`;
  }
  if (!input.projectId) {
    return "Choose a project to run the task in.";
  }
  if (!projectFound) {
    return "The selected project is no longer available. Choose another project.";
  }
  if (!input.rootPath) {
    return "The selected project has no folder on disk. Choose a project with a local folder.";
  }
  if (!Number.isFinite(input.nextAt)) {
    return "Enter a valid run date and time.";
  }
  const now = Date.now() / 1000;
  if (input.nextAt <= now) {
    return "The run time is in the past. Choose a future date and time (check AM/PM).";
  }
  if (input.nextAt > now + MAX_LEAD_SECONDS) {
    return "The run time is too far ahead. Choose a date within ten years.";
  }
  const minutes = input.intervalMinutes;
  if (minutes !== null) {
    if (!Number.isInteger(minutes)) {
      return "The interval must be a whole number of minutes.";
    }
    if (minutes < 1) {
      return "The interval must be at least 1 minute.";
    }
    if (minutes > MAX_INTERVAL_MINUTES) {
      return `The interval cannot exceed ${MAX_INTERVAL_MINUTES.toLocaleString("en-US")} minutes (one year).`;
    }
  }
  return "";
}

export function useScheduleForm({
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
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? initialProject ?? "");
  const [agent, setAgent] = useState<ScheduledTaskInput["agent"]>(task?.agent ?? "cairngorm");
  const [start, setStart] = useState(
    localDateTime(Math.max(task?.nextAt ?? 0, Date.now() / 1000 + 300)),
  );
  const [interval, setInterval] = useState(
    task?.intervalMinutes ? String(task.intervalMinutes) : "",
  );
  const [reviewing, setReviewing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const project = projects.find((project) => project.id === projectId);
  const input: ScheduledTaskInput = {
    id: task?.id ?? null,
    title: title.trim(),
    prompt: prompt.trim(),
    projectId,
    projectName: project?.name ?? "",
    rootPath: project?.rootPath ?? "",
    agent,
    nextAt: Math.floor(new Date(start).getTime() / 1000),
    intervalMinutes: interval ? Number(interval) : null,
  };
  const submit = async (event: Event) => {
    event.preventDefault();
    setError("");
    const problem = validate(input, Boolean(project));
    if (problem) {
      setError(problem);
      return;
    }
    if (!reviewing) {
      setReviewing(true);
      return;
    }
    if (busy) {
      return;
    }
    if (!consent) {
      setError("Confirm that you allow the agent to run unattended before activating.");
      return;
    }
    setBusy(true);
    try {
      await saveScheduledTask(input);
      onSaved(input.projectId);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return {
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
  };
}
