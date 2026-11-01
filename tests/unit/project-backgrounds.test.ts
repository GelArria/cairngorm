import { describe, it, expect } from "vitest";
import { STONES, defaultStone, gemYaw, parseBackground, projectStone } from "@/projects/visuals";

describe("project stones", () => {
  it("every project gets a stable stone and gem angle by default", () => {
    const a = defaultStone("abc-123");
    expect(defaultStone("abc-123")).toBe(a);
    expect(STONES).toContain(a);
    expect(parseBackground({ id: "abc-123" })).toEqual({ kind: "stone", stone: a });
    expect(gemYaw("abc-123")).toBe(gemYaw("abc-123"));
    expect(gemYaw("abc-123")).toBeGreaterThanOrEqual(0);
  });

  it("uses the selected project color for every background and restores the stone on reset", () => {
    for (const background of [undefined, "preset:ruby", "image:C:/a.png", "none"]) {
      expect(projectStone({ id: "x", background, color: "clay" }).color).toBe("#cf8a6d");
    }
    expect(projectStone({ id: "x", background: "preset:ruby", color: undefined }).color).toBe(
      "#ff8a9a",
    );
  });

  it("defaults only use the original nine stones, so added stones never recolour projects", () => {
    const original = STONES.slice(0, 9);
    for (let i = 0; i < 200; i++) {
      expect(original).toContain(defaultStone(`project-${i}`));
    }
    expect(defaultStone("abc-123").id).toBe("emerald");
  });

  it("smoky quartz (the brand stone) is one of them", () => {
    expect(STONES[0]).toMatchObject({ id: "quartz", color: "#d9c4a8" });
  });

  it("parses stone / image / none; unknown stones fall back to the default", () => {
    expect(parseBackground({ id: "x", background: "preset:ruby" })).toMatchObject({
      kind: "stone",
      stone: { id: "ruby" },
    });
    expect(parseBackground({ id: "x", background: "image:C:/pics/a b.png" })).toEqual({
      kind: "image",
      path: "C:/pics/a b.png",
    });
    expect(parseBackground({ id: "x", background: "none" })).toEqual({ kind: "none" });
    expect(parseBackground({ id: "x", background: "preset:gone" })).toEqual({
      kind: "stone",
      stone: defaultStone("x"),
    });
    // an image keeps the default stone for the gem / accent
    expect(projectStone({ id: "x", background: "image:C:/a.png" })).toBe(defaultStone("x"));
  });
});
