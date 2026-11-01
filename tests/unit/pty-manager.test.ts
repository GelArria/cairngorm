import { describe, it, expect } from "vitest";
import { concatBytes, stripReplaySuffix } from "../../src/terminal/data/pty-manager";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("concatBytes", () => {
  it("concatenates byte chunks", () => {
    expect(dec(concatBytes([enc("ab"), enc("cd")]))).toBe("abcd");
  });
  it("empty returns empty", () => {
    expect(concatBytes([]).length).toBe(0);
  });
});

describe("stripReplaySuffix", () => {
  it("discards queued when already contained in the replay buffer", () => {
    const replay = enc("banner\n❯ hello\nACK");
    expect(stripReplaySuffix(replay, enc("ACK")).length).toBe(0);
  });
  it("keeps the queued suffix when there is no overlap", () => {
    const replay = enc("banner");
    expect(dec(stripReplaySuffix(replay, enc("NEW")))).toBe("NEW");
  });
  it("keeps partial queued (replay tail not exact)", () => {
    const replay = enc("banner");
    expect(dec(stripReplaySuffix(replay, enc("banneX")))).toBe("banneX");
  });
  it("empty queued returns empty", () => {
    expect(stripReplaySuffix(enc("data"), new Uint8Array(0)).length).toBe(0);
  });
  it("empty replay keeps queued", () => {
    expect(dec(stripReplaySuffix(new Uint8Array(0), enc("x")))).toBe("x");
  });
});
