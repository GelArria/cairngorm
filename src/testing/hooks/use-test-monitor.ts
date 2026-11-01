import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "preact/hooks";
import type { AgentEvent } from "../../terminal/shared/agent-events";
import type { TermTab } from "../../terminal/types";
import { openTestsTab } from "../../terminal/workspace";
import {
  finishBrowserActivities,
  forgetBrowserActivities,
  isBrowserActivity,
  publishBrowserActivity,
  type BrowserActivity,
} from "../data/browser-activity";
import {
  finishBrowserStreams,
  forgetBrowserStreams,
  hasActiveBrowserStreams,
  hasBrowserPage,
  isBrowserFrame,
  publishBrowserFrame,
  type BrowserFrame,
} from "../data/browser-store";
import { isTestAutoOpenEnabled } from "../data/test-auto-open";
import { forgetTestPane } from "../data/test-pane-state";
import { forgetTestRun, publishTestRun } from "../data/test-store";
import { NativeTestGroup } from "../model/native-test-group";
import { TestTracker } from "../model/test-tracker";

interface Observation {
  stop: () => void;
  tracker: TestTracker;
  native: NativeTestGroup;
}

/** Lives in App, so inactive projects, hidden views and detached PTYs stay observed. */
export function useTestMonitor(tabs: TermTab[]) {
  const observations = useRef(new Map<string, Observation>());
  const sessions = tabs
    .filter((t) => !t.kind)
    .map((t) => t.sessionId)
    .sort()
    .join("\0");
  useEffect(() => {
    const active = new Set(sessions ? sessions.split("\0") : []);
    for (const [id, observer] of observations.current) {
      if (!active.has(id)) {
        observer.stop();
        observations.current.delete(id);
        forgetTestRun(id);
        forgetTestPane(id);
        forgetBrowserStreams(id);
        forgetBrowserActivities(id);
      }
    }
    for (const id of active) {
      if (observations.current.has(id)) {
        continue;
      }
      let activeRun = false;
      let visualOnly = false;
      let visualRun: import("../model/types").TestRun | undefined;
      let publications = 0;
      const publish = (
        run: import("../model/types").TestRun,
        started: boolean,
        preserveVisual = false,
      ) => {
        publications++;
        if (started) {
          if (!preserveVisual) {
            visualRun = undefined;
            forgetBrowserStreams(id);
            forgetBrowserActivities(id);
          }
          visualOnly = false;
        }
        activeRun = run.status === "running";
        if (!activeRun) {
          visualOnly = false;
        }
        publishTestRun(run);
        // Off: the run still publishes to any open view, but no view opens or takes focus.
        if (started && isTestAutoOpenEnabled()) {
          openTestsTab(id);
        }
      };
      const tracker = new TestTracker(id, (run, started) => {
        publish(run, started);
        visualRun = run;
      });
      const native = new NativeTestGroup(id, publish);
      let stopped = false;
      const cleanup: (() => void)[] = [];
      const register = (promise: Promise<() => void>) => {
        promise
          .then((un) => {
            if (stopped) {
              un();
            } else {
              cleanup.push(un);
            }
          })
          .catch((err) => console.error("[testing] Could not observe terminal", id, err));
      };
      type Update = {
        run: import("../model/types").TestRun;
        started: boolean;
        generation: number;
        revision: number;
      };
      let generation = 0,
        revision = -1;
      const receive = (update: Update | null) => {
        if (
          stopped ||
          !update ||
          update.run?.sessionId !== id ||
          update.generation < generation ||
          (update.generation === generation && update.revision < revision)
        ) {
          return;
        }
        generation = update.generation;
        revision = update.revision;
        // A fast page may already be closed: preserve only overlapping Playwright executions.
        const preserveVisual =
          update.run.runner === "Playwright" &&
          !!visualRun &&
          (update.run.endedAt ?? Infinity) >= visualRun.startedAt &&
          update.run.startedAt <= (visualRun.endedAt ?? Infinity);
        publish(update.run, update.started, preserveVisual);
        visualOnly = false;
        visualRun = undefined;
      };
      register(
        listen<Update>(`pty-test-${id}`, ({ payload }) => receive(payload)).then((un) => {
          // Subscribe first; a restored PTY may already have produced its test header.
          void invoke<Update | null>("pty_test_run", { sessionId: id })
            .then((update) => {
              // Any live observation supersedes this one-time restoration, including browser/tools.
              if (publications === 0) {
                receive(update);
              }
            })
            .catch((err) => console.error("[testing] Could not restore test observation", id, err));
          return un;
        }),
      );
      register(
        listen<BrowserFrame | BrowserActivity>(`test-browser-${id}`, ({ payload }) => {
          if (stopped || !payload) {
            return;
          }
          if (payload.type === "activity") {
            if (!isBrowserActivity(payload)) {
              return;
            }
            if (!activeRun && payload.status === "running" && !hasBrowserPage(id, payload.pageId)) {
              tracker.start("Playwright");
              visualOnly = true;
            }
            publishBrowserActivity(id, payload);
            return;
          }
          if (!isBrowserFrame(payload)) {
            return;
          }
          if (payload.type === "frame" && !activeRun && !hasBrowserPage(id, payload.pageId)) {
            tracker.start("Playwright");
            visualOnly = true;
          }
          publishBrowserFrame(id, payload);
          if (payload.type === "closed") {
            finishBrowserActivities(id, payload.pageId);
          }
          if (payload.type === "closed" && visualOnly && !hasActiveBrowserStreams(id)) {
            tracker.finish("completed");
          }
        }),
      );
      register(
        listen(`pty-exit-${id}`, () => {
          if (!stopped) {
            if (visualOnly) {
              tracker.finish("interrupted");
            }
            native.stop();
            finishBrowserStreams(id);
            finishBrowserActivities(id);
          }
        }),
      );
      observations.current.set(id, {
        tracker,
        native,
        stop: () => {
          stopped = true;
          cleanup.forEach((un) => un());
          if (visualOnly) {
            tracker.finish("interrupted");
          }
          native.stop();
        },
      });
    }
  }, [sessions]);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    listen<AgentEvent>("agent-event", ({ payload: event }) => {
      if (stopped) {
        return;
      }
      const observer = observations.current.get(event.session_id);
      if (!observer) {
        return;
      }
      observer.native.event(event);
    })
      .then((un) => {
        if (stopped) {
          un();
        } else {
          unlisten = un;
        }
      })
      .catch((err) => console.error("[testing] Could not observe agent events", err));
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  useEffect(
    () => () => {
      observations.current.forEach((observer, id) => {
        observer.stop();
        forgetTestRun(id);
        forgetTestPane(id);
        forgetBrowserStreams(id);
        forgetBrowserActivities(id);
      });
      observations.current.clear();
    },
    [],
  );
}
