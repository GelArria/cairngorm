import { describe, it, expect, afterEach } from "vitest";
import { suppressNativeChrome } from "@/app/native-chrome";

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});

const rightClick = (init: MouseEventInit = {}, el: Element = document.body) => {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const key = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e;
};

describe("suppressNativeChrome", () => {
  it("cancels the native context menu anywhere", () => {
    off = suppressNativeChrome(document, false);
    expect(rightClick().defaultPrevented).toBe(true);
    expect(rightClick({ shiftKey: true }).defaultPrevented).toBe(true);
  });

  it("keeps the normal Windows edit menu in text fields only", () => {
    off = suppressNativeChrome(document, false);
    const input = document.body.appendChild(document.createElement("input"));
    const area = document.body.appendChild(document.createElement("textarea"));
    const box = document.body.appendChild(document.createElement("input"));
    box.type = "checkbox";
    expect(rightClick({}, input).defaultPrevented).toBe(false);
    expect(rightClick({}, area).defaultPrevented).toBe(false);
    expect(rightClick({}, box).defaultPrevented).toBe(true);
    expect(rightClick().defaultPrevented).toBe(true);
    input.remove();
    area.remove();
    box.remove();
  });

  it("still lets the app's own onContextMenu handlers run", () => {
    off = suppressNativeChrome(document, false);
    let ran = false;
    document.body.addEventListener(
      "contextmenu",
      () => {
        ran = true;
      },
      { once: true },
    );
    rightClick();
    expect(ran).toBe(true);
  });

  it.each([undefined, null, 42])("ignores keydown events without a string key (%s)", (value) => {
    off = suppressNativeChrome(document, false);
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      const event = new Event("keydown", { bubbles: true, cancelable: true });
      if (value !== undefined) {
        Object.defineProperty(event, "key", { value });
      }
      document.body.dispatchEvent(event);
      expect(errors).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("preserves native spelling/edit menus inside rich text without bypassing app handlers", () => {
    off = suppressNativeChrome(document, false);
    const editor = document.body.appendChild(document.createElement("div"));
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("spellcheck", "true");
    const word = editor.appendChild(document.createElement("span"));
    try {
      expect(rightClick({}, word).defaultPrevented).toBe(false);
      editor.addEventListener("contextmenu", (event) => event.preventDefault(), { once: true });
      expect(rightClick({}, word).defaultPrevented).toBe(true);
    } finally {
      editor.remove();
    }
  });

  it("blocks reload / print shortcuts in production", () => {
    off = suppressNativeChrome(document, false);
    expect(key({ key: "F5" }).defaultPrevented).toBe(true);
    expect(key({ key: "r", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: "p", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: "a", ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("dev builds keep Shift+right-click (Inspect) and reload", () => {
    off = suppressNativeChrome(document, true);
    expect(rightClick({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(rightClick().defaultPrevented).toBe(true);
    expect(key({ key: "F5" }).defaultPrevented).toBe(false);
  });
});
