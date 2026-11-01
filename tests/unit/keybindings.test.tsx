import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import {
  KEYBINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  bindingFromEvent,
  getBinding,
  handleBinding,
  matchesBinding,
  resetBindings,
  setBinding,
} from "@/keybindings/data/keybindings";
import { normalizeBinding } from "@/keybindings/model/keybinding-keys";
import { useKeybinds } from "@/keybindings/hooks/use-keybinds";
import { KeybindingSettings } from "@/settings/components/keybinding-settings";
import { HelpPanel } from "@/app/app-header/help-panel";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    clear: () => data.clear(),
  });
  resetBindings();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  resetBindings();
  vi.unstubAllGlobals();
});
const key = (value: string, options: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });

describe("keybinding preferences", () => {
  it("has unique defaults, normalizes modifiers, Caps Lock, Mac and zoom aliases", () => {
    expect(new Set(KEYBINDINGS.map((d) => d.default)).size).toBe(KEYBINDINGS.length);
    expect(normalizeBinding("Shift+Ctrl+k")).toBe("Ctrl+Shift+K");
    expect(bindingFromEvent(key("N", { ctrlKey: true }))).toBe("Ctrl+N");
    expect(bindingFromEvent(key("n", { metaKey: true, shiftKey: true }))).toBe("Ctrl+Shift+N");
    expect(bindingFromEvent(key("+", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+=");
    expect(bindingFromEvent(key("_", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+-");
    expect(bindingFromEvent(key("|", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+\\");
    expect(bindingFromEvent(key("?", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+/");
    expect(normalizeBinding("Ctrl+Shift+=")).toBe("Ctrl+=");
    expect(normalizeBinding("n")).toBeNull();
    expect(normalizeBinding("Shift+Enter")).toBeNull();
    expect(normalizeBinding("Alt+F4")).toBeNull();
    expect(normalizeBinding("Alt+Tab")).toBeNull();
    expect(normalizeBinding("Ctrl+C")).toBeNull();
    expect(normalizeBinding("Ctrl+Shift+V")).toBeNull();
    expect(normalizeBinding("Ctrl+Z")).toBeNull();
    expect(normalizeBinding("Ctrl+Ctrl+N")).toBeNull();
  });
  it("rejects conflicts and supports persistence, disable and per-action reset", () => {
    expect(setBinding("settings", "Ctrl+S")).toContain("Save file");
    expect(getBinding("settings")).toBe("Ctrl+,");
    expect(setBinding("settings", "Ctrl+Shift+K")).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)!)).toEqual({
      settings: "Ctrl+Shift+K",
    });
    expect(setBinding("settings", null)).toBeNull();
    expect(getBinding("settings")).toBeNull();
    expect(setBinding("settings", undefined)).toBeNull();
    expect(getBinding("settings")).toBe("Ctrl+,");
  });
  it("validates externally changed storage and handles cleared or malformed data", () => {
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ settings: "Ctrl+S", newFile: "x", unknown: "Ctrl+K" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: KEYBINDINGS_STORAGE_KEY }));
    expect(getBinding("settings")).toBe("Ctrl+S");
    expect(getBinding("saveFile")).toBeNull();
    expect(getBinding("newFile")).toBe("Ctrl+Alt+N");
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, "broken");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(getBinding("settings")).toBe("Ctrl+,");
    expect(getBinding("saveFile")).toBe("Ctrl+S");
  });
  it("does not apply a change when persistence fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(setBinding("settings", "Ctrl+K")).toContain("Could not save");
    expect(getBinding("settings")).toBe("Ctrl+,");
  });
});

describe("keyboard routing", () => {
  it("preserves terminal editing, but allows explicitly scoped pane commands", () => {
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const textarea = document.createElement("textarea");
    terminal.append(textarea);
    document.body.append(terminal);
    let appMatch = true,
      paneMatch = false;
    textarea.addEventListener("keydown", (e) => {
      appMatch = matchesBinding(e, "closeTab");
      paneMatch = matchesBinding(e, "closePane");
    });
    textarea.dispatchEvent(key("w", { ctrlKey: true }));
    expect(appMatch).toBe(false);
    textarea.dispatchEvent(key("w", { ctrlKey: true, shiftKey: true }));
    expect(paneMatch).toBe(true);
    expect(setBinding("closePane", "Ctrl+K")).toBeNull();
    textarea.dispatchEvent(key("k", { ctrlKey: true }));
    expect(paneMatch).toBe(false);
  });
  it("preserves xterm control-character aliases for pane, global and detached commands", () => {
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const textarea = document.createElement("textarea");
    terminal.append(textarea);
    document.body.append(terminal);
    let matched = true;
    for (const id of ["closePane", "settings", "reattach"] as const) {
      const check = (e: KeyboardEvent) => {
        matched = matchesBinding(e, id);
      };
      textarea.addEventListener("keydown", check);
      for (const [binding, value, shift] of [
        ["Ctrl+[", "[", false],
        ["Ctrl+]", "]", false],
        ["Ctrl+Space", " ", false],
        ["Ctrl+3", "3", false],
        ["Ctrl+8", "8", false],
        ["Ctrl+Shift+2", "@", true],
      ] as const) {
        resetBindings();
        expect(setBinding(id, binding)).toBeNull();
        textarea.dispatchEvent(key(value, { ctrlKey: true, shiftKey: shift }));
        expect(matched).toBe(false);
        expect(matchesBinding(key(value, { ctrlKey: true, shiftKey: shift }), id)).toBe(true);
      }
      textarea.removeEventListener("keydown", check);
    }
  });
  it("lets editor handlers own their commands before running unhandled app shortcuts", () => {
    const split = vi.fn(),
      next = vi.fn();
    function Harness() {
      useKeybinds({ splitHorizontal: split, nextTab: next });
      return (
        <div class="cm-editor">
          <textarea
            onKeyDown={(e) => {
              if (e.key === "|") e.preventDefault();
            }}
          />
        </div>
      );
    }
    const { container } = render(<Harness />);
    const input = container.querySelector("textarea")!;
    fireEvent(input, key("|", { ctrlKey: true, shiftKey: true }));
    expect(split).not.toHaveBeenCalled();
    fireEvent(input, key("Tab", { ctrlKey: true }));
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("ignores dialogs, menus, repeats, composition and prevented events", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(matchesBinding(key(",", { ctrlKey: true }), "settings")).toBe(false);
    dialog.remove();
    expect(matchesBinding(key("n", { ctrlKey: true, repeat: true }), "newTerminal")).toBe(false);
    expect(matchesBinding(key("n", { ctrlKey: true, isComposing: true }), "newTerminal")).toBe(
      false,
    );
    const prevented = key("n", { ctrlKey: true });
    prevented.preventDefault();
    expect(matchesBinding(prevented, "newTerminal")).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    expect(matchesBinding(key("n", { ctrlKey: true }), "newTerminal")).toBe(false);
  });
  it("dispatches once, follows live remapping and uses the latest handler", () => {
    const first = vi.fn(),
      second = vi.fn();
    function Harness({ action }: { action: () => void }) {
      useKeybinds({ newTerminal: action });
      return null;
    }
    const view = render(<Harness action={first} />);
    fireEvent(window, key("N", { ctrlKey: true }));
    expect(first).toHaveBeenCalledTimes(1);
    act(() => {
      setBinding("newTerminal", "Ctrl+K");
    });
    view.rerender(<Harness action={second} />);
    fireEvent(window, key("n", { ctrlKey: true }));
    expect(second).not.toHaveBeenCalled();
    fireEvent(window, key("k", { ctrlKey: true }));
    expect(second).toHaveBeenCalledTimes(1);
    const event = key("k", { ctrlKey: true });
    const action = vi.fn();
    expect(handleBinding(event, "newTerminal", action)).toBe(true);
    expect(handleBinding(event, "newTerminal", action)).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("does not navigate from editable fields", () => {
    const input = document.createElement("input");
    document.body.append(input);
    let matched = true;
    input.addEventListener("keydown", (e) => {
      matched = matchesBinding(e, "back");
    });
    input.dispatchEvent(key("ArrowLeft", { altKey: true }));
    expect(matched).toBe(false);
  });
});

it("records keys, shows conflicts, cancels safely and keeps help in sync", () => {
  render(
    <>
      <KeybindingSettings />
      <HelpPanel />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Open settings shortcut" }));
  fireEvent(window, key("s", { ctrlKey: true }));
  expect(screen.getByRole("alert").textContent).toContain("Save file");
  fireEvent(window, key("k", { ctrlKey: true, shiftKey: true }));
  expect(getBinding("settings")).toBe("Ctrl+Shift+K");
  expect(screen.getByTestId("help-panel").textContent).toContain("CtrlShiftK");
  fireEvent.click(screen.getByRole("button", { name: "Edit Open settings shortcut" }));
  const escape = key("Escape");
  fireEvent(window, escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(screen.queryByText("Press keys…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Disable Open settings shortcut" }));
  expect(getBinding("settings")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Restore all defaults" }));
  expect(getBinding("settings")).toBe("Ctrl+,");
});
