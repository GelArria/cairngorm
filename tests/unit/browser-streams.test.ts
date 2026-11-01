import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, expect, it } from "vitest";
import {
  finishBrowserStreams,
  forgetBrowserStreams,
  publishBrowserFrame,
} from "../../src/testing/data/browser-store";
import { useBrowserStreams } from "@/testing/hooks/use-browser-streams";

afterEach(() => {
  cleanup();
  forgetBrowserStreams("test");
});
const frame = (pageId: string, timestamp = 1) => ({
  type: "frame" as const,
  pageId,
  timestamp,
  image: "/9j/AA==",
  width: 800,
  height: 600,
  url: "http://localhost:3000",
});

it("keeps separate pages and the last actual image after a browser closes", () => {
  const hook = renderHook(() => useBrowserStreams("test"));
  act(() => {
    publishBrowserFrame("test", frame("a"));
    publishBrowserFrame("test", frame("b"));
  });
  act(() =>
    publishBrowserFrame(
      "test",
      JSON.parse(
        '{"type":"closed","pageId":"a","timestamp":2,"image":null,"url":null,"width":null,"height":null}',
      ),
    ),
  );
  expect(hook.result.current).toHaveLength(2);
  expect(hook.result.current.find((s) => s.pageId === "a")).toMatchObject({
    type: "closed",
    image: "/9j/AA==",
  });
  act(() => finishBrowserStreams("test"));
  expect(hook.result.current.every((s) => s.type === "closed")).toBe(true);
});

it("ignores stale or invalid frames and never revives a closed page", () => {
  const hook = renderHook(() => useBrowserStreams("test"));
  act(() => {
    publishBrowserFrame("test", frame("a", 3));
    publishBrowserFrame("test", { ...frame("a", 2), url: "stale" });
    publishBrowserFrame("test", { ...frame("b"), image: "<script>" });
    publishBrowserFrame("test", { type: "closed", pageId: "unknown", timestamp: 5 });
  });
  expect(hook.result.current).toHaveLength(1);
  expect(hook.result.current[0].url).toBe("http://localhost:3000");
  act(() => {
    publishBrowserFrame("test", { type: "closed", pageId: "a", timestamp: 4 });
    publishBrowserFrame("test", frame("a", 5));
  });
  expect(hook.result.current[0].type).toBe("closed");
});

it("keeps native image references through close and rejects paths instead of image IDs", () => {
  const hook = renderHook(() => useBrowserStreams("test"));
  const imageId = "b3a5e1d0-7469-4e16-b714-34fc080c07aa";
  act(() => {
    publishBrowserFrame("test", { ...frame("a"), image: undefined, imageId });
    publishBrowserFrame("test", { ...frame("b"), image: undefined, imageId: "../../secret" });
    publishBrowserFrame("test", { type: "closed", pageId: "a", timestamp: 2 });
  });
  expect(hook.result.current).toHaveLength(1);
  expect(hook.result.current[0]).toMatchObject({ imageId, type: "closed" });
});

it("bounds retained images and clears them when their source terminal disappears", () => {
  const hook = renderHook(() => useBrowserStreams("test"));
  act(() => {
    for (let n = 0; n < 30; n++) publishBrowserFrame("test", frame(String(n)));
  });
  expect(hook.result.current).toHaveLength(12);
  act(() => forgetBrowserStreams("test"));
  expect(hook.result.current).toHaveLength(0);
});

it("retains the engine and project through teardown, rejecting invalid metadata", () => {
  const hook = renderHook(() => useBrowserStreams("test"));
  act(() => {
    publishBrowserFrame("test", {
      ...frame("firefox"),
      browserName: "firefox",
      projectName: "Mobile checkout",
    });
    publishBrowserFrame("test", { type: "closed", pageId: "firefox", timestamp: 2 });
    publishBrowserFrame("test", { ...frame("bad"), browserName: "unknown" as any });
    publishBrowserFrame("test", { ...frame("too-long"), projectName: "x".repeat(513) });
  });
  expect(hook.result.current).toHaveLength(1);
  expect(hook.result.current[0]).toMatchObject({
    type: "closed",
    browserName: "firefox",
    projectName: "Mobile checkout",
  });
});
