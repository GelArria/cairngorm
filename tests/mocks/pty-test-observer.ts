// Emulate the native wire contract in mocked browser tests; Rust parity has its own harness.
import { TestTracker } from "../../src/testing/model/test-tracker";
import { TerminalLines } from "../../src/testing/model/terminal-lines";
import { emit } from "./tauri-event";
import type { TestRun } from "../../src/testing/model/types";

const observers = new Map<
  string,
  {
    tracker: TestTracker;
    lines: TerminalLines;
    update?: { run: TestRun; started: boolean; generation: number; revision: number };
  }
>();
function observer(id: string) {
  if (!observers.has(id)) {
    let revision = 0;
    const tracker = new TestTracker(id, (run, started) => {
      const state = observers.get(id)!;
      state.update = {
        run,
        started: started || !!state.update?.started,
        generation: 1,
        revision: ++revision,
      };
    });
    observers.set(id, {
      tracker,
      lines: new TerminalLines((line, redraw) => tracker.line(line, redraw)),
    });
  }
  return observers.get(id)!;
}
async function publish(id: string) {
  const state = observer(id),
    update = state.update;
  state.update = undefined;
  if (update) await emit(`pty-test-${id}`, update);
}
export async function output(id: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  observer(id).lines.push(bytes);
  await emit(`pty-data-${id}`, { data: btoa(String.fromCharCode(...bytes)) });
  await publish(id);
}
export async function finish(id: string) {
  const state = observer(id);
  state.lines.flush();
  state.tracker.finish("interrupted");
  await publish(id);
}
