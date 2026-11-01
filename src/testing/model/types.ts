export type TestStatus = "running" | "passed" | "failed" | "completed" | "interrupted";
export type ResultStatus = "passed" | "failed" | "skipped";
export interface TestResult {
  name: string;
  status: ResultStatus;
}
export interface TestRun {
  id: number;
  sessionId: string;
  runner: string;
  command?: string;
  status: TestStatus;
  startedAt: number;
  endedAt?: number;
  total?: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  output: string[];
}
export interface TestSignal {
  runner?: string;
  start?: boolean;
  restart?: boolean;
  suite?: string;
  package?: string;
  total?: number;
  result?: TestResult;
  counts?: Partial<Record<ResultStatus, number>>;
  resetCounts?: boolean;
  end?: boolean;
  failed?: boolean;
}
