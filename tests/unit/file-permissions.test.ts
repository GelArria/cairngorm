import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FilePermission } from "@/plugins/hooks/use-file-permissions";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
import { useFilePermissions } from "@/plugins/hooks/use-file-permissions";
const scopes = [{ terminal: "source", projectId: "project", rootPath: "C:/Project" }];
const permission: Omit<FilePermission, "receivedAt"> = {
  ...scopes[0],
  requestId: "request",
  path: "C:/External/file.txt",
  access: "read",
  directory: false,
};
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listeners.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const emit = (event: string, payload: unknown) =>
  act(() => {
    mocks.listeners.get(event)!({ payload });
  });
it("discards approvals when their source project root changes and on global revocation", async () => {
  const view = renderHook(({ current }) => useFilePermissions(current), {
    initialProps: { current: scopes },
  });
  await waitFor(() => expect(mocks.listeners.size).toBe(3));
  emit("plugin-file-permission", permission);
  expect(view.result.current.current?.requestId).toBe("request");
  view.rerender({ current: [{ ...scopes[0], rootPath: "C:/Changed" }] });
  await waitFor(() => expect(view.result.current.current).toBeUndefined());
  view.rerender({ current: scopes });
  emit("plugin-file-permission", permission);
  emit("plugin-file-access-changed", false);
  expect(view.result.current.current).toBeUndefined();
});
it("expires unanswered approvals after sixty seconds without sending an allow", async () => {
  vi.useFakeTimers();
  const view = renderHook(() => useFilePermissions(scopes));
  expect(mocks.listeners.size).toBe(3);
  emit("plugin-file-permission", permission);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(view.result.current.current).toBeUndefined();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps a failed allow visible and still sends a deny when dismissing an expired native request", async () => {
  const view = renderHook(() => useFilePermissions(scopes));
  await waitFor(() => expect(mocks.listeners.size).toBe(3));
  emit("plugin-file-permission", permission);
  mocks.invoke.mockRejectedValue(new Error("This file approval expired."));
  await act(async () => {
    await view.result.current.reply("file");
  });
  expect(view.result.current.error).toContain("expired");
  expect(view.result.current.current).toBeDefined();
  await act(async () => {
    await view.result.current.reply("deny");
  });
  expect(mocks.invoke).toHaveBeenLastCalledWith("plugin_file_permission_reply", {
    requestId: "request",
    decision: "deny",
  });
  expect(view.result.current.current).toBeUndefined();
});
it("acknowledges first-use questions and drops them once file access is always allowed", async () => {
  mocks.invoke.mockResolvedValue(undefined);
  const view = renderHook(() => useFilePermissions(scopes));
  await waitFor(() => expect(mocks.listeners.size).toBe(3));
  emit("plugin-file-permission", { ...permission, requestId: "consent", access: "consent" });
  emit("plugin-file-permission", permission);
  expect(view.result.current.current?.requestId).toBe("consent");
  expect(mocks.invoke).toHaveBeenCalledWith("plugin_file_request_seen", { requestId: "consent" });
  emit("plugin-file-consent-granted", null);
  expect(view.result.current.current?.requestId).toBe("request");
});
it("an application's Always answers that project's questions only", async () => {
  mocks.invoke.mockResolvedValue(undefined);
  const both = [...scopes, { terminal: "other", projectId: "other", rootPath: "C:/Other" }];
  const view = renderHook(() => useFilePermissions(both));
  await waitFor(() => expect(mocks.listeners.size).toBe(3));
  const app = { ...permission, access: "consent" as const, subject: "app:excel" };
  emit("plugin-file-permission", { ...app, requestId: "here" });
  emit("plugin-file-permission", { ...app, ...both[1], requestId: "there" });
  emit("plugin-file-consent-granted", { subject: "app:excel", projectId: "project" });
  expect(view.result.current.current?.requestId).toBe("there");
});
