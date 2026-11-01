import type { AgentEvent } from "../../terminal/shared/agent-events";
import { toolCommand, toolExitCode, toolOutput } from "./agent-test-output";
import { TerminalLines } from "./terminal-lines";
import { testCommand } from "./test-signals";
import { TestTracker } from "./test-tracker";
import type { TestRun } from "./types";

interface Job {
  tracker: TestTracker;
  lines: TerminalLines;
  text: string;
  run?: TestRun;
}

/** Native tools may run in parallel; each owns its parser and contributes to one pane. */
export class NativeTestGroup {
  private jobs = new Map<string, Job>();
  private id = 0;
  constructor(
    private sessionId: string,
    private publish: (run: TestRun, started: boolean) => void,
  ) {}

  event(event: AgentEvent) {
    if (event.type === "tool_execution_start") {
      if (!/^(bash|shell|exec|execute_command)$/.test(event.toolName)) {
        return;
      }
      const command = toolCommand(event.args),
        runner = testCommand(command);
      if (!runner) {
        return;
      }
      const newGroup = ![...this.jobs.values()].some((job) => job.run?.status === "running");
      if (newGroup) {
        this.jobs.clear();
        this.id++;
      }
      const tracker = new TestTracker(
        this.sessionId,
        (run) => {
          this.jobs.get(event.toolCallId)!.run = run;
          this.update();
        },
        true,
      );
      const lines = new TerminalLines((line) => tracker.line(line));
      this.jobs.set(event.toolCallId, { tracker, lines, text: "" });
      tracker.start(runner, command);
      if (newGroup) {
        this.update(true);
      }
    } else if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const job = this.jobs.get(event.toolCallId);
      if (!job) {
        return;
      }
      const text = toolOutput(
        event.type === "tool_execution_update" ? event.partialResult : event.result,
      );
      const delta = text.startsWith(job.text) ? text.slice(job.text.length) : text;
      job.text = text;
      job.lines.text(delta);
      if (event.type === "tool_execution_end") {
        job.lines.flush();
        const code = toolExitCode(event.result);
        job.tracker.finish(
          code === 130 || code === 124
            ? "interrupted"
            : event.isError || (code != null && code !== 0)
              ? "failed"
              : "completed",
        );
      }
    }
  }

  stop() {
    this.jobs.forEach((job) => {
      job.lines.flush();
      job.tracker.finish("interrupted");
    });
  }

  private update(started = false) {
    const runs = [...this.jobs.values()].flatMap((job) => (job.run ? [job.run] : []));
    if (!runs.length) {
      return;
    }
    const running = runs.some((run) => run.status === "running");
    const status = running
      ? "running"
      : runs.some((run) => run.status === "failed")
        ? "failed"
        : runs.some((run) => run.status === "interrupted")
          ? "interrupted"
          : runs.every((run) => run.status === "passed")
            ? "passed"
            : "completed";
    const total = runs.every((run) => run.total != null)
      ? runs.reduce((n, run) => n + run.total!, 0)
      : undefined;
    const label = (run: TestRun) => run.command ?? run.runner;
    this.publish(
      {
        ...runs[0],
        id: this.id,
        runner: runs.length === 1 ? runs[0].runner : "Concurrent tests",
        command: runs.length === 1 ? runs[0].command : `${runs.length} test commands`,
        status,
        total,
        startedAt: Math.min(...runs.map((run) => run.startedAt)),
        endedAt: running ? undefined : Math.max(...runs.map((run) => run.endedAt ?? Date.now())),
        passed: runs.reduce((n, run) => n + run.passed, 0),
        failed: runs.reduce((n, run) => n + run.failed, 0),
        skipped: runs.reduce((n, run) => n + run.skipped, 0),
        results: runs
          .flatMap((run) =>
            run.results.map((row) => ({
              ...row,
              name: runs.length > 1 ? `${label(run)} › ${row.name}` : row.name,
            })),
          )
          .slice(-500),
        output: runs
          .flatMap((run) => (runs.length > 1 ? [`$ ${label(run)}`, ...run.output] : run.output))
          .slice(-600),
      },
      started,
    );
  }
}
