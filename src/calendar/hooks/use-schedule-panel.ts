import { actOnScheduledTask, type ScheduledTask } from "@/calendar/data/scheduled-tasks";
import { useScheduledTasks } from "@/calendar/hooks/use-scheduled-tasks";
import { errorMessage } from "@/common/errors";
import { useState } from "preact/hooks";

export function useSchedulePanel({ projectId }: { projectId: string | null }) {
  const data = useScheduledTasks();
  const [removing, setRemoving] = useState<ScheduledTask | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const result = tasks.find((task) => task.id === resultId);
  const act = async (task: ScheduledTask, action: "pause" | "resume" | "run" | "delete") => {
    setBusy(true);
    setError("");
    try {
      await actOnScheduledTask(task.id, action);
      setRemoving(null);
      data.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return { data, removing, setRemoving, setResultId, busy, error, setError, tasks, result, act };
}
