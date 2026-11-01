import { invoke } from "@tauri-apps/api/core";

export interface ScheduleProject {
  id: string;
  name: string;
  rootPath: string;
}

export interface ScheduledTaskInput {
  id: string | null;
  title: string;
  prompt: string;
  projectId: string;
  projectName: string;
  rootPath: string;
  agent: "cairngorm" | "codex" | "gemini";
  nextAt: number;
  intervalMinutes: number | null;
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string;
  enabled: boolean;
  requested: boolean;
  status: "scheduled" | "running" | "succeeded" | "failed" | "interrupted";
  lastRun: number | null;
  output: string;
  /** Files the last run changed ("<status> <path>"); absent outside Git projects. */
  changes?: string[];
}

export const loadScheduledTasks = () => invoke<ScheduledTask[]>("scheduled_tasks_list");
export const SCHEDULE_EDIT_EVENT = "calendar-edit-schedule";
export const requestScheduleForm = (task: ScheduledTask | null, projectId: string | null) =>
  window.dispatchEvent(new CustomEvent(SCHEDULE_EDIT_EVENT, { detail: { task, projectId } }));
export const saveScheduledTask = async (input: ScheduledTaskInput) => {
  await invoke<void>("scheduled_tasks_save", { input });
  window.dispatchEvent(new Event("scheduled-tasks-changed"));
};
export const actOnScheduledTask = (id: string, action: "pause" | "resume" | "run" | "delete") =>
  invoke<void>("scheduled_tasks_action", { id, action });
export const deleteProjectScheduledTasks = (projectId: string) =>
  invoke<void>("scheduled_tasks_delete_project", { projectId });

export function localDateTime(time: number) {
  const date = new Date(time * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function scheduleLabel(task: Pick<ScheduledTaskInput, "intervalMinutes" | "nextAt">) {
  return task.intervalMinutes
    ? `Every ${task.intervalMinutes} minutes`
    : `Once · ${new Date(task.nextAt * 1000).toLocaleString()}`;
}
