import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalHealth } from "../../src/terminal/runtime/terminal-health";

describe("Terminal health lifecycle", () => {
  let term: Terminal;

  beforeEach(() => {
    vi.useFakeTimers();
    term = new Terminal();
    vi.spyOn(term, "write").mockImplementation(() => {});
  });

  afterEach(() => {
    term.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createHealth(isAgent = false) {
    const onStatusChange = vi.fn();
    const onRestart = vi.fn();
    const health = createTerminalHealth({
      term,
      shellFile: "sh",
      isAgent,
      tryOpen: () => true,
      onStatusChange,
      onRestart,
    });
    return { health, onStatusChange, onRestart };
  }

  it("cancels startup recovery after data arrives and emits running only once", () => {
    const { health, onStatusChange, onRestart } = createHealth();
    health.schedule();
    health.markAttached();
    health.onDataReceived();
    health.onDataReceived();
    vi.advanceTimersByTime(10000);

    expect(onStatusChange.mock.calls).toEqual([["running"]]);
    expect(onRestart).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers an unsettled attachment after the existing startup delay", () => {
    const { health, onStatusChange, onRestart } = createHealth();
    health.schedule();
    vi.advanceTimersByTime(8000);

    expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
    expect(onRestart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("does not restart a settled attachment just because output is delayed", () => {
    const { health, onRestart } = createHealth();
    health.schedule();
    health.markAttached();
    vi.advanceTimersByTime(10000);

    expect(onRestart).not.toHaveBeenCalled();
  });

  it("suppresses a pending recovery after disposal", () => {
    const { health, onRestart } = createHealth();
    health.schedule();
    vi.advanceTimersByTime(8000);
    health.dispose();
    vi.advanceTimersByTime(1000);

    expect(health.isDisposed).toBe(true);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("marks a user terminal idle when it exits successfully after output", () => {
    const { health, onStatusChange } = createHealth();
    health.markAttached();
    health.onDataReceived();
    health.onExit(0);

    expect(health.isPtyAlive).toBe(false);
    expect(onStatusChange).toHaveBeenLastCalledWith("idle");
    expect(term.write).toHaveBeenCalled();
  });

  it("marks an exit without output as an error", () => {
    const { health, onStatusChange } = createHealth();
    health.onExit(0);

    expect(health.isPtyAlive).toBe(false);
    expect(onStatusChange).toHaveBeenLastCalledWith("error");
  });

  it("keeps agent sessions reusable and cancels their exit check on new output", () => {
    const { health, onStatusChange, onRestart } = createHealth(true);
    health.markAttached();
    health.onDataReceived();
    health.onExit(0);

    expect(health.isPtyAlive).toBe(true);
    expect(term.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    health.onDataReceived();
    vi.advanceTimersByTime(16000);
    expect(vi.getTimerCount()).toBe(0);
    expect(onStatusChange.mock.calls).toEqual([["running"]]);
    expect(onRestart).not.toHaveBeenCalled();
  });
});
