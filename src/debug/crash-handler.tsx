import { recordCrash } from "@/debug/data/crash-store";
import { useCrashCapture } from "@/debug/hooks/use-crash-capture";
import { BoundaryProps, BoundaryState } from "@/debug/model/use-crash-capture";
import type { ErrorInfo } from "preact";
import { Component } from "preact";
import { CrashDialog } from "./components/crash-dialog";

export class CrashBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, report: null };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      report: {
        source: "render" as const,
        message: error.message,
        location: "",
        stacktrace: error.stack ?? "",
        timestamp: new Date().toISOString(),
      },
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordCrash("global", "render", error, info?.componentStack);
    const combined = (error.stack ?? "") + "\n\nComponent Stack:\n" + (info?.componentStack ?? "");
    this.props.onCrash({ ...this.state.report!, stacktrace: combined });
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export function CrashProvider({ children }: { children: preact.ComponentChildren }) {
  const { report, addReport } = useCrashCapture();

  return (
    <CrashBoundary onCrash={addReport}>
      {children}
      {report && <CrashDialog report={report} />}
    </CrashBoundary>
  );
}
