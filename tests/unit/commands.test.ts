import { afterEach, describe, expect, it, vi } from "vitest";
import { commandAction, registerCommands, runCommand } from "@/keybindings/data/commands";

const cleanups: Array<() => void> = [];
const register = (...args: Parameters<typeof registerCommands>) => {
  const off = registerCommands(...args);
  cleanups.push(off);
  return off;
};

afterEach(() => {
  cleanups.splice(0).forEach((off) => off());
});

describe("command registry", () => {
  it("runs the first enabled source that offers the command", () => {
    const first = vi.fn();
    const second = vi.fn();
    register({ handlers: () => ({ newTerminal: first }), enabled: () => true });
    register({ handlers: () => ({ newTerminal: second }), enabled: () => true });
    expect(runCommand("newTerminal")).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("falls through a disabled source to the next one", () => {
    const hidden = vi.fn();
    const visible = vi.fn();
    register({ handlers: () => ({ newTerminal: hidden }), enabled: () => false });
    register({ handlers: () => ({ newTerminal: visible }), enabled: () => true });
    runCommand("newTerminal");
    expect(hidden).not.toHaveBeenCalled();
    expect(visible).toHaveBeenCalledOnce();
  });

  it("treats a missing handler as unavailable", () => {
    register({ handlers: () => ({ newTerminal: undefined }), enabled: () => true });
    expect(commandAction("newTerminal")).toBeUndefined();
    expect(runCommand("newTerminal")).toBe(false);
  });

  it("stops offering a command once its source unregisters", () => {
    const off = register({ handlers: () => ({ newTerminal: vi.fn() }), enabled: () => true });
    expect(commandAction("newTerminal")).toBeDefined();
    off();
    expect(commandAction("newTerminal")).toBeUndefined();
  });
});
