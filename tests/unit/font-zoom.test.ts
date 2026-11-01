import { describe, it, expect } from "vitest";
import { subscribeFontSize, getFontScale } from "../../src/terminal/data/font-zoom";

function pressKey(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

describe("font-zoom", () => {
  it("Ctrl+= zooms in, Ctrl+- out, Ctrl+0 resets", () => {
    const seen: number[] = [];
    const unsub = subscribeFontSize((fs) => seen.push(fs));
    // fresh module (empty localStorage) starts at base 14
    expect(seen[seen.length - 1]).toBe(14);

    pressKey("="); // zoom in
    expect(seen[seen.length - 1]).toBe(15);
    expect(getFontScale()).toBeCloseTo(15 / 14);

    pressKey("-"); // back out
    expect(seen[seen.length - 1]).toBe(14);

    pressKey("-"); // below base
    expect(seen[seen.length - 1]).toBe(13);

    pressKey("0"); // reset to base
    expect(seen[seen.length - 1]).toBe(14);
    unsub();
  });

  it("clamps between 8 and 32", () => {
    const seen: number[] = [];
    const unsub = subscribeFontSize((fs) => seen.push(fs));
    for (let i = 0; i < 30; i++) pressKey("=");
    expect(seen[seen.length - 1]).toBe(32);
    for (let i = 0; i < 40; i++) pressKey("-");
    expect(seen[seen.length - 1]).toBe(8);
    pressKey("0");
    expect(seen[seen.length - 1]).toBe(14);
    unsub();
  });

  it("ignores keys without Ctrl", () => {
    const seen: number[] = [];
    const unsub = subscribeFontSize((fs) => seen.push(fs));
    const before = seen[seen.length - 1];
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }),
    );
    expect(seen.length).toBe(1); // only the initial subscribe callback
    expect(before).toBe(14);
    unsub();
  });
});
