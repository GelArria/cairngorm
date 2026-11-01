import type { ResultStatus } from "../model/types";
import type { BrowserStream } from "./browser-store";

export interface TestPaneMemory {
  runId?: string | number;
  view: "results" | "output" | "app" | "preview";
  selectedPage?: string;
  filter: "all" | ResultStatus;
  query: string;
  follow: boolean;
  scrollTop: number;
  frozen?: BrowserStream;
  pauseError?: string;
}
const panes = new Map<string, TestPaneMemory>();
export function testPaneMemory(
  id: string,
  runId?: string | number,
  hasScreen = false,
): TestPaneMemory {
  let pane = panes.get(id);
  if (!pane) {
    pane = {
      runId,
      view: runId == null ? "preview" : hasScreen ? "app" : "results",
      filter: "all",
      query: "",
      follow: true,
      scrollTop: 0,
    };
    panes.set(id, pane);
  }
  if (pane.runId !== runId) {
    pane.runId = runId;
    pane.selectedPage = undefined;
    pane.frozen = undefined;
    pane.pauseError = undefined;
  }
  return pane;
}
export function forgetTestPane(id: string) {
  panes.delete(id);
}
