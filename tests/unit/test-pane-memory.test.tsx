import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { useTestPaneState } from "../../src/testing/hooks/use-test-pane-state";
import { forgetTestPane } from "../../src/testing/data/test-pane-state";
import { publishTestRun, forgetTestRun } from "../../src/testing/data/test-store";
import { publishBrowserFrame, forgetBrowserStreams } from "../../src/testing/data/browser-store";
import type { TestRun } from "../../src/testing/model/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const sessionId = "memory-test";
afterEach(() => {
  cleanup();
  forgetTestPane(sessionId);
  forgetTestRun(sessionId);
  forgetBrowserStreams(sessionId);
});
const run: TestRun = {
  id: 1,
  sessionId,
  runner: "vitest",
  status: "failed",
  startedAt: 100,
  passed: 1,
  failed: 1,
  skipped: 0,
  results: [{ name: "failure", status: "failed" }],
  output: ["test output"],
};

it("retains mode, filter, query, page selection and a paused frame across unmounts", async () => {
  publishTestRun(run);
  publishBrowserFrame(sessionId, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "YWJj",
    width: 640,
    height: 480,
  });
  const first = renderHook(() => useTestPaneState(sessionId));
  act(() => {
    first.result.current.selectPage("page");
    first.result.current.toggleFailed();
    first.result.current.setQuery("failure");
    first.result.current.setFollow(false);
  });
  await act(async () => {
    await first.result.current.togglePause();
  });
  act(() => first.result.current.setView("output"));
  expect(first.result.current.paused).toBe(true);
  first.unmount();
  const second = renderHook(() => useTestPaneState(sessionId));
  expect(second.result.current.view).toBe("output");
  expect(second.result.current.filter).toBe("failed");
  expect(second.result.current.query).toBe("failure");
  expect(second.result.current.follow).toBe(false);
  expect(second.result.current.selectedPage).toBe("page");
  expect(second.result.current.paused).toBe(true);
  expect(second.result.current.displayed?.image).toBe("YWJj");
  expect(second.result.current.run).toBe(run);
  second.unmount();
  publishTestRun({ ...run, id: 2 });
  const next = renderHook(() => useTestPaneState(sessionId));
  expect(next.result.current.selectedPage).toBeUndefined();
  expect(next.result.current.paused).toBe(false);
  expect(next.result.current.query).toBe("failure");
});

it("restores the output scroll position without resuming automatic following", () => {
  publishTestRun(run);
  const first = renderHook(() => useTestPaneState(sessionId));
  act(() => {
    first.result.current.setView("output");
    first.result.current.setFollow(false);
  });
  const output = document.createElement("div");
  first.result.current.outputRef.current = output;
  output.scrollTop = 137;
  first.result.current.rememberScroll();
  first.unmount();
  const restoredOutput = document.createElement("div");
  const second = renderHook(() => {
    const pane = useTestPaneState(sessionId);
    pane.outputRef.current = restoredOutput;
    return pane;
  });
  expect(second.result.current.view).toBe("output");
  expect(second.result.current.follow).toBe(false);
  expect(restoredOutput.scrollTop).toBe(137);
});
