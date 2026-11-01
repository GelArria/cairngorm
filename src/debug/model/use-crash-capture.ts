import type { CrashReport } from "@/debug/model/types";

export interface BoundaryProps {
  onCrash: (report: CrashReport) => void;
  children: preact.ComponentChildren;
}

export interface BoundaryState {
  hasError: boolean;
  report: CrashReport | null;
}
