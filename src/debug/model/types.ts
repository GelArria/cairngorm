export interface CrashReport {
  source: "rust" | "js" | "render" | "unhandledrejection";
  message: string;
  location: string;
  stacktrace: string;
  timestamp: string;
}

export interface StackSample {
  time: number;
  delayMs: number;
  stack: string;
}

export interface DiagSnapshot {
  timestamp: string;
  activeView: string;
  heapMb: number;
  lastLongtask: string;
  recentInvokes: string[];
  longTaskCount: number;
  rssMb: number;
  uiStuck: boolean;
  lastJsStacks: StackSample[];
}
