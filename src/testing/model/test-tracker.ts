import { testSignal } from "./test-signals";
import type { TestRun } from "./types";

/** One live execution per terminal. No command is executed by this observer. */
export class TestTracker {
  private run?: TestRun;
  private failed = false;
  private resultKeys = new Map<string, "passed" | "failed" | "skipped">();
  private summary = false;
  private goVerbose = false;
  private seenHeaders = new Set<string>();
  private goNames = new Set<string>();
  private suite = "";
  private baseline = { passed: 0, failed: 0, skipped: 0, total: 0 };
  constructor(
    private sessionId: string,
    private publish: (run: TestRun, started: boolean) => void,
    private controlled = false,
  ) {}

  start(runner: string, command?: string) {
    this.failed = false;
    this.summary = false;
    this.suite = "";
    this.goVerbose = false;
    this.baseline = { passed: 0, failed: 0, skipped: 0, total: 0 };
    this.resultKeys.clear();
    this.goNames.clear();
    this.run = {
      id: (this.run?.id ?? 0) + 1,
      sessionId: this.sessionId,
      runner,
      command,
      status: "running",
      startedAt: Date.now(),
      passed: 0,
      failed: 0,
      skipped: 0,
      results: [],
      output: [],
    };
    this.publish(this.run, true);
  }

  line(line: string, redraw = false) {
    const signal = testSignal(line, this.run?.status === "running" ? this.run.runner : undefined);
    if (
      redraw &&
      this.run &&
      this.run.status !== "running" &&
      (!signal?.start || this.seenHeaders.has(line.trim()))
    ) {
      return;
    }
    if (signal?.suite) {
      if (!this.run) {
        this.start("Cargo");
      }
      if (this.run!.runner !== "Cargo") {
        return;
      }
      this.baseline = {
        passed: this.run!.passed,
        failed: this.run!.failed,
        skipped: this.run!.skipped,
        total: this.run!.total ?? 0,
      };
      this.suite = signal.suite;
      this.run = { ...this.run!, status: "running", endedAt: undefined };
    }
    if (signal?.start) {
      if (
        this.run?.status === "running" &&
        this.run.runner !== "Tests" &&
        this.run.runner !== signal.runner
      ) {
        return;
      }
      const nextGoPackage =
        this.run?.runner === "Go" && this.goVerbose && signal.runner === "Go" && !signal.restart;
      if (!this.run || (this.run.status !== "running" && !nextGoPackage) || signal.restart) {
        this.start(signal.runner!);
      } else if (signal.runner) {
        this.run = { ...this.run, runner: signal.runner };
      }
      this.run = { ...this.run!, status: "running", endedAt: undefined };
      this.seenHeaders.add(line.trim());
      if (this.seenHeaders.size > 128) {
        this.seenHeaders.delete(this.seenHeaders.values().next().value!);
      }
      if (signal.runner === "Go") {
        this.goVerbose = true;
      }
    } else if (signal?.package) {
      if (!this.run || this.run.runner !== "Go" || this.resultKeys.has(signal.package)) {
        this.start("Go");
      }
      this.run = { ...this.run!, status: "running", endedAt: undefined };
    } else if (!this.run && signal?.runner && (signal.result || signal.end)) {
      this.start(signal.runner);
    }
    if (!this.run || (this.run.status !== "running" && !signal?.counts && !signal?.end)) {
      return;
    }
    let run = { ...this.run, output: [...this.run.output, line.slice(0, 16384)].slice(-600) };
    if (signal?.package && this.goNames.size) {
      run.results = run.results.map((row) =>
        this.goNames.has(row.name) ? { ...row, name: `${signal.package} › ${row.name}` } : row,
      );
      for (const name of this.goNames) {
        const status = this.resultKeys.get(name)!;
        this.resultKeys.delete(name);
        this.resultKeys.set(`${signal.package} › ${name}`, status);
      }
      this.goNames.clear();
    }
    if (signal?.total != null) {
      run.total = signal.total + this.baseline.total;
    }
    if (signal?.failed) {
      this.failed = true;
    }
    if (signal?.result) {
      const result = {
        ...signal.result,
        name: this.suite ? `${this.suite} › ${signal.result.name}` : signal.result.name,
      };
      if (run.runner === "Go" && !signal.package) {
        this.goNames.add(result.name);
      }
      const previous = this.resultKeys.get(result.name);
      if (previous !== result.status) {
        this.resultKeys.set(result.name, result.status);
        if (this.resultKeys.size > 10000) {
          this.resultKeys.delete(this.resultKeys.keys().next().value!);
        }
        if (!signal?.package || !this.goVerbose) {
          if (previous) {
            run[previous]--;
          }
          run[result.status]++;
        }
        run.results = [...run.results.filter((r) => r.name !== result.name), result].slice(-500);
      }
    }
    if (signal?.counts) {
      // Final summaries are authoritative; unspecified categories are zero.
      run = {
        ...run,
        ...(signal.resetCounts
          ? {
              passed: this.baseline.passed,
              failed: this.baseline.failed,
              skipped: this.baseline.skipped,
            }
          : {}),
      };
      for (const key of ["passed", "failed", "skipped"] as const) {
        if (signal.counts[key] != null) {
          run[key] = signal.counts[key]! + this.baseline[key];
        }
      }
    }
    this.run = run;
    if (signal?.end) {
      this.summary = true;
      // Summaries can span several lines (Playwright); later totals still apply.
      this.run = this.controlled
        ? run
        : {
            ...run,
            status: this.failed || run.failed > 0 ? "failed" : "passed",
            endedAt: Date.now(),
          };
      this.publish(this.run, false);
    } else {
      this.publish(run, false);
    }
  }

  finish(status: "passed" | "failed" | "completed" | "interrupted") {
    if (!this.run) {
      return;
    }
    // PTY teardown cannot change an execution already finalized by its runner/tool.
    if (this.run.status !== "running") {
      return;
    }
    const outcome =
      status === "completed"
        ? this.failed || this.run.failed > 0
          ? "failed"
          : this.summary
            ? "passed"
            : "completed"
        : status;
    this.run = { ...this.run, status: outcome, endedAt: Date.now() };
    this.publish(this.run, false);
  }
}
