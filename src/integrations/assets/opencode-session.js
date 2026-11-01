// Managed by Cairngorm. Observe the TUI selection, NOT server-global session events.
import { writeFileSync, renameSync } from "node:fs";

function observe(api, v2) {
  const file = process.env.CAIRNGORM_SESSION_REPORT;
  if (!file) {
    return;
  }
  let previous;
  const report = () => {
    const route = v2 ? api.route.current : api.ui.router.current();
    const id = v2
      ? route?.name === "session"
        ? route.params?.sessionID
        : undefined
      : route?.type === "session"
        ? route.sessionID
        : undefined;
    if (!id || id === previous) {
      return;
    }
    const session = v2 ? api.state.session.get(id) : api.data.session.get(id);
    if (!session) {
      return;
    } // route can precede hydration
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({ agent: "opencode", id, cwd: session.directory || process.cwd() }),
      );
      renameSync(tmp, file);
      previous = id;
    } catch {
      /* never interrupt the TUI */
    }
  };
  const timer = setInterval(report, 250);
  timer.unref?.();
  report();
  return () => clearInterval(timer);
}

export default {
  id: "cairngorm.session-selection",
  setup: (api) => observe(api, false),
  tui: async (api) => {
    const dispose = observe(api, true);
    if (dispose) {
      api.lifecycle.onDispose(dispose);
    }
  },
};
