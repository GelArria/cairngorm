import { errorMessage } from "@/common/errors";
import { useEffect, useState } from "preact/hooks";
import { loadScheduledTasks, type ScheduledTask } from "../data/scheduled-tasks";

export function useScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const load = async () => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        const tasks = await loadScheduledTasks();
        if (!disposed) {
          setTasks(tasks);
          setError("");
        }
      } catch (error) {
        if (!disposed) {
          setError(errorMessage(error));
        }
      } finally {
        pending = false;
        if (!disposed) {
          setLoading(false);
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 2000);
    window.addEventListener("scheduled-tasks-changed", load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("scheduled-tasks-changed", load);
    };
  }, [revision]);
  return {
    tasks,
    loading,
    error,
    clearError: () => setError(""),
    refresh: () => setRevision((v) => v + 1),
  };
}
