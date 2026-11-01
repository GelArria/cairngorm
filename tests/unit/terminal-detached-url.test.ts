import { describe, it, expect, vi } from "vitest";
import {
  buildDetachedUrl,
  getDetachedTabInfoFromUrl,
} from "../../src/terminal/data/terminal-window";
import type { TermTab, TileLayout } from "../../src/terminal/model/types";

describe("Detached URL serialization", () => {
  const fakeTab: TermTab = {
    id: "t42",
    sessionId: "term-42",
    openedAt: 1_800_000_000_000,
    title: "Code",
    profile: "code-assistant",
    status: "running",
    detached: false,
    shellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    shellArgs: ["-NoLogo"],
    shellEnv: { FOO: "bar" },
  };

  const layout: TileLayout = {
    columnCount: 2,
    columnRatios: [1, 1],
    cells: [
      { id: "c1", tabId: "t42", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { id: "c2", tabId: "t43", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    ],
  };

  it("buildDetachedUrl serializes member data into URL", () => {
    const url = buildDetachedUrl([fakeTab]);
    expect(url).toContain("?detached=t42");
    expect(url).toContain("data=");
  });

  it("SECURITY: shellEnv (API keys) never leaks into the URL", () => {
    const url = buildDetachedUrl([fakeTab]);
    expect(url).not.toContain("FOO");
    expect(url).not.toContain("bar");
  });

  it("getDetachedTabInfoFromUrl round-trips single member", () => {
    const url = buildDetachedUrl([fakeTab]);
    const search = new URL(url).search;
    vi.stubGlobal("location", { search });

    const info = getDetachedTabInfoFromUrl();
    expect(info).not.toBeNull();
    expect(info!.id).toBe("t42");
    expect(info!.members).toHaveLength(1);
    expect(info!.members[0].sessionId).toBe("term-42");
    expect(info!.members[0].openedAt).toBe(fakeTab.openedAt);
    expect(info!.members[0].title).toBe("Code");
    expect(info!.members[0].shellPath).toBe(fakeTab.shellPath);
    expect(info!.members[0].shellArgs).toEqual(["-NoLogo"]);
    expect(info!.layout).toBeNull();

    vi.unstubAllGlobals();
  });

  it("getDetachedTabInfoFromUrl round-trips split group with layout", () => {
    const second = { ...fakeTab, id: "t43", sessionId: "term-43" };
    const url = buildDetachedUrl([fakeTab, second], layout);
    vi.stubGlobal("location", { search: new URL(url).search });

    const info = getDetachedTabInfoFromUrl();
    expect(info!.id).toBe("t42"); // primario = primer miembro
    expect(info!.members).toHaveLength(2);
    expect(info!.members.map((m) => m.id)).toEqual(["t42", "t43"]);
    expect(info!.layout).toEqual(layout); // grid conservado intacto

    vi.unstubAllGlobals();
  });

  it("getDetachedTabInfoFromUrl returns null for missing params", () => {
    vi.stubGlobal("location", { search: "" });
    expect(getDetachedTabInfoFromUrl()).toBeNull();

    vi.stubGlobal("location", { search: "?detached=x" });
    expect(getDetachedTabInfoFromUrl()).toBeNull();

    vi.unstubAllGlobals();
  });
});
