import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { attachPty } from "../../src/terminal/data/pty-manager";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const options = { sessionId: "listener-lifecycle", shellPath: "sh" };

describe("PTY listener ownership", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    vi.mocked(listen).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("releases the data listener when exit registration fails", async () => {
    const unlistenData = vi.fn();
    const failure = new Error("Exit listener registration failed");
    vi.mocked(listen).mockResolvedValueOnce(unlistenData).mockRejectedValueOnce(failure);

    await expect(attachPty(options)).rejects.toBe(failure);

    expect(unlistenData).toHaveBeenCalledOnce();
    expect(vi.mocked(listen).mock.calls.map(([event]) => event)).toEqual([
      "pty-data-listener-lifecycle",
      "pty-exit-listener-lifecycle",
    ]);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "pty_kill")).toBe(false);
  });

  it("preserves the registration error when cleanup also throws", async () => {
    const unlistenData = vi.fn(() => {
      throw new Error("Listener already destroyed");
    });
    const failure = new Error("Exit listener registration failed");
    vi.mocked(listen).mockResolvedValueOnce(unlistenData).mockRejectedValueOnce(failure);

    await expect(attachPty(options)).rejects.toBe(failure);

    expect(unlistenData).toHaveBeenCalledOnce();
  });

  it("does not register an exit listener when data registration fails", async () => {
    const failure = new Error("Data listener registration failed");
    vi.mocked(listen).mockRejectedValueOnce(failure);

    await expect(attachPty(options)).rejects.toBe(failure);

    expect(listen).toHaveBeenCalledOnce();
  });

  it.each([
    [
      { historical: true, size: { cols: 171, rows: 50 } },
      { cols: 171, rows: 50 },
    ],
    [{ historical: false, size: { cols: 2000, rows: 24 } }, undefined],
    [{ historical: true }, undefined],
    [{ historical: true, size: { cols: 0, rows: 50 } }, undefined],
    [{ historical: true, size: { cols: 171, rows: 0.5 } }, undefined],
  ])("exposes only valid historical replay dimensions: %j", async (metadata, expected) => {
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "pty_replay" ? { data: btoa("ready"), ...metadata } : null,
    );
    const pty = await attachPty(options);
    const onData = vi.fn();
    pty.onData(onData);
    expect(pty.replaySize).toEqual(expected);
    expect(pty.flushReplay()).toBe(true);
    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe("ready");
    expect(onData.mock.calls[0][1]).toBe(metadata.historical);
    pty.detach();
  });

  it("detaches both listeners exactly once", async () => {
    const unlistenData = vi.fn();
    const unlistenExit = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlistenData).mockResolvedValueOnce(unlistenExit);
    const pty = await attachPty(options);

    pty.detach();
    pty.detach();

    expect(unlistenData).toHaveBeenCalledOnce();
    expect(unlistenExit).toHaveBeenCalledOnce();
  });

  it("still releases the exit listener when data cleanup throws", async () => {
    const unlistenData = vi.fn(() => {
      throw new Error("Listener already destroyed");
    });
    const unlistenExit = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlistenData).mockResolvedValueOnce(unlistenExit);
    const pty = await attachPty(options);

    expect(() => pty.detach()).not.toThrow();
    pty.detach();

    expect(unlistenData).toHaveBeenCalledOnce();
    expect(unlistenExit).toHaveBeenCalledOnce();
  });
});
