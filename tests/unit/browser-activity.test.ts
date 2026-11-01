import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, expect, it } from "vitest";
import {
  finishBrowserActivities,
  forgetBrowserActivities,
  publishBrowserActivity,
  type BrowserActivity,
} from "../../src/testing/data/browser-activity";
import { useBrowserActivities } from "@/testing/hooks/use-browser-activities";

afterEach(() => {
  cleanup();
  forgetBrowserActivities("test");
});
const action = (
  activityId: string,
  status: BrowserActivity["status"] = "running",
  timestamp = 10,
): BrowserActivity => ({
  type: "activity",
  pageId: "page",
  activityId,
  startedAt: 10,
  timestamp,
  label: "Click · Checkout",
  status,
});

it("updates a step in place and ignores late start messages after completion", () => {
  const hook = renderHook(() => useBrowserActivities("test"));
  act(() => {
    publishBrowserActivity("test", action("a"));
    publishBrowserActivity("test", action("b"));
  });
  act(() => publishBrowserActivity("test", action("a", "completed", 20)));
  act(() => publishBrowserActivity("test", action("a", "running", 30)));
  expect(hook.result.current).toHaveLength(2);
  expect(hook.result.current[0]).toMatchObject({
    activityId: "a",
    status: "completed",
    timestamp: 20,
  });
});

it("marks interrupted work without claiming it succeeded and isolates pages", () => {
  const hook = renderHook(() => useBrowserActivities("test"));
  act(() => {
    publishBrowserActivity("test", action("a"));
    publishBrowserActivity("test", { ...action("b"), pageId: "other" });
    finishBrowserActivities("test", "page");
  });
  expect(hook.result.current.map((a) => a.status)).toEqual(["interrupted", "running"]);
  act(() => forgetBrowserActivities("test"));
  expect(hook.result.current).toHaveLength(0);
});

it("rejects invalid events and bounds retained history", () => {
  const hook = renderHook(() => useBrowserActivities("test"));
  act(() => {
    publishBrowserActivity("test", { ...action("bad"), timestamp: 0 });
    publishBrowserActivity("test", { ...action("bad"), label: "x".repeat(513) });
  });
  expect(hook.result.current).toHaveLength(0);
  act(() => {
    for (let n = 0; n < 210; n++)
      publishBrowserActivity("test", { ...action(String(n)), startedAt: n, timestamp: n });
  });
  expect(hook.result.current).toHaveLength(200);
  expect(hook.result.current[0].activityId).toBe("10");
});
