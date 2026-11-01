// UI contract fixture only; native scheduler and real sidecar settlement have separate tests.
export const SCHEDULE_INIT = `
(() => {
  const api = window.__TAURI_INTERNALS__, original = api.invoke;
  const load = () => JSON.parse(localStorage.getItem("qa-scheduled-tasks") || "[]");
  const save = tasks => localStorage.setItem("qa-scheduled-tasks", JSON.stringify(tasks));
  api.invoke = (cmd, args) => {
    if (cmd === "plugin:sql|select" && /FROM\\s+projects\\s/i.test(String(args?.query))) {
      return Promise.resolve(["one", "two"].map((id, i) => ({ id, name: i ? "Other project" : "Cairngorm", root_path: "C:/" + id, color: null, background: null, gem_cut: null, created_at: "2026-01-01 00:00:00" })));
    }
    if (cmd === "scheduled_tasks_list") return Promise.resolve(load());
    if (cmd === "scheduled_tasks_delete_project" && window.__FAIL_PROJECT_DELETE__) return Promise.reject("Wait for this project's scheduled run to finish before deleting it.");
    if (cmd === "scheduled_tasks_save") {
      if (window.__FAIL_SCHEDULE_SAVE__) return Promise.reject("Could not save schedule");
      const tasks = load(), input = args.input;
      const index = tasks.findIndex(task => task.id === input.id);
      const task = { ...input, id: input.id || crypto.randomUUID(), enabled: true, requested: false, status: "scheduled", lastRun: null, output: "" };
      if (index < 0) tasks.push(task); else tasks[index] = task;
      save(tasks);
      return Promise.resolve();
    }
    if (cmd === "scheduled_tasks_action") {
      let tasks = load();
      const task = tasks.find(task => task.id === args.id);
      if (args.action === "delete") tasks = tasks.filter(task => task.id !== args.id);
      if (args.action === "pause") task.enabled = false;
      if (args.action === "resume") task.enabled = true;
      if (args.action === "run") {
        task.lastRun = Math.floor(Date.now() / 1000);
        task.status = "succeeded";
        task.output = "Review finished. No changes were committed.";
        if (!task.intervalMinutes) task.enabled = false;
      }
      save(tasks);
      return Promise.resolve();
    }
    return original(cmd, args);
  };
})();
`;
