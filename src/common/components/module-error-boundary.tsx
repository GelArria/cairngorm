import { recordCrash } from "@/debug/data/crash-store";
import type { ErrorInfo } from "preact";
import { Component } from "preact";

interface Props {
  module: string;
  children: preact.ComponentChildren;
  /** Optional fallback rendered instead of null when the module crashes. */
  fallback?: preact.ComponentChild;
  /** When true, changing this prop resets the boundary (retry). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/** Error boundary that logs render crashes to the crash store and renders null (invisible) on error.
 *  Pass a changing `resetKey` to retry rendering after a crash. */
export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when resetKey changes (parent-initiated retry)
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordCrash(this.props.module, "render", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
