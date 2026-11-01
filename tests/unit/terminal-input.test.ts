import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { clipboardKeyHandler } from "../../src/terminal/runtime/clipboard-keys";
import {
  getTerminalPreferences,
  setTerminalPreferences,
  TERMINAL_DEFAULTS,
} from "../../src/terminal/data/terminal-preferences";

const copy = vi.fn(async () => {});
const read = vi.fn(async () => "a  b\nc");
const paste = vi.fn();
const input = vi.fn();
const term = {
  hasSelection: () => true,
  getSelection: () => "selected",
  paste,
  input,
} as unknown as Terminal;
const key = (k: string, ctrlKey = true, shiftKey = false) =>
  new KeyboardEvent("keydown", { key: k, ctrlKey, shiftKey, cancelable: true });

beforeEach(() => {
  vi.stubGlobal("navigator", { clipboard: { readText: read, writeText: copy } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.clearAllMocks();
  setTerminalPreferences(TERMINAL_DEFAULTS);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setTerminalPreferences(TERMINAL_DEFAULTS);
});

it("copies selected text, but Ctrl+C without a selection reaches the program", () => {
  const event = key("c");
  expect(clipboardKeyHandler(event, term)).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(copy).toHaveBeenCalledWith("selected");
  expect(clipboardKeyHandler(key("c"), { ...term, hasSelection: () => false } as Terminal)).toBe(
    true,
  );
});

it("pastes directly with both Ctrl+V variants and plain Shift+Insert", async () => {
  for (const event of [key("v"), key("v", true, true), key("Insert", false, true)]) {
    expect(clipboardKeyHandler(event, term)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  }
  await Promise.resolve();
  expect(paste.mock.calls).toEqual([["a  b\nc"], ["a  b\nc"], ["a  b\nc"]]);
});

const clipboardWith = (platform: string, types: string[]) => ({
  platform,
  clipboard: { readText: async () => "", read: async () => [{ types }] },
});

it("hands a clipboard image to the program as its paste key", async () => {
  for (const [platform, expected] of [
    ["Win32", "\x1bv"],
    ["MacIntel", "\x16"],
  ]) {
    vi.stubGlobal("navigator", clipboardWith(platform, ["image/png"]));
    input.mockClear();
    expect(clipboardKeyHandler(key("v"), term)).toBe(false);
    await vi.waitFor(() => expect(input).toHaveBeenCalledWith(expected, true));
  }
  expect(paste).not.toHaveBeenCalled();
});

it("sends nothing for an empty clipboard", async () => {
  vi.stubGlobal("navigator", clipboardWith("Win32", []));
  expect(clipboardKeyHandler(key("v"), term)).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(input).not.toHaveBeenCalled();
  expect(paste).not.toHaveBeenCalled();
});

it("strict Ctrl+Shift mode leaves plain Ctrl+C/V to the program even with selected text", () => {
  setTerminalPreferences({ clipboard: "ctrl-shift" });
  expect(clipboardKeyHandler(key("c"), term)).toBe(true);
  expect(clipboardKeyHandler(key("v"), term)).toBe(true);
  expect(copy).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(clipboardKeyHandler(key("c", true, true), term)).toBe(false);
  expect(clipboardKeyHandler(key("v", true, true), term)).toBe(false);
});

it("bounds and persists scrollback; rejects malformed shell settings", () => {
  setTerminalPreferences({ scrollback: Infinity });
  expect(getTerminalPreferences().scrollback).toBe(3000);
  for (const [input, expected] of [
    [1, 100],
    [1000000, 100000],
    [456.6, 457],
  ]) {
    setTerminalPreferences({ scrollback: input });
    expect(getTerminalPreferences().scrollback).toBe(expected);
  }
  setTerminalPreferences({ defaultShell: { path: 42 } as any });
  expect(getTerminalPreferences().defaultShell).toBeNull();
  expect(localStorage.setItem).toHaveBeenCalled();
});
