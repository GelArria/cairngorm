import { describe, it, expect, beforeEach } from "vitest";
import {
  recordNav,
  stepNav,
  canNav,
  resetNav,
  type NavLocation,
} from "@/common/navigation/nav-history";

const at = (view: string, tabId: string | null = null): NavLocation => ({
  view,
  groupId: "g1",
  tabId,
});
const all = () => true;

describe("nav history", () => {
  beforeEach(() => resetNav());

  it("goes back and forward through recorded places", () => {
    recordNav(at("chat", "t1"));
    recordNav(at("calendar"));
    recordNav(at("chat", "t2"));
    expect(canNav(-1)).toBe(true);
    expect(canNav(1)).toBe(false);
    expect(stepNav(-1, all)).toEqual(at("calendar"));
    recordNav(at("calendar")); // the app settles on it
    expect(stepNav(-1, all)).toEqual(at("chat", "t1"));
    recordNav(at("chat", "t1"));
    expect(canNav(-1)).toBe(false);
    expect(stepNav(1, all)).toEqual(at("calendar"));
  });

  it("ignores repeats and truncates the forward history on a new place", () => {
    recordNav(at("chat", "t1"));
    recordNav(at("chat", "t1"));
    recordNav(at("chat", "t2"));
    stepNav(-1, all);
    recordNav(at("chat", "t1"));
    recordNav(at("calendar")); // new branch
    expect(canNav(1)).toBe(false);
    expect(stepNav(-1, all)).toEqual(at("chat", "t1"));
  });

  it("skips places whose pane was closed", () => {
    recordNav(at("chat", "gone"));
    recordNav(at("chat", "t2"));
    recordNav(at("calendar"));
    const loc = stepNav(-1, (l) => l.tabId !== "gone");
    expect(loc).toEqual(at("chat", "t2"));
    recordNav(at("chat", "t2"));
    expect(stepNav(-1, (l) => l.tabId !== "gone")).toBeNull();
  });

  it("stores what the app really showed after a step (no new branch)", () => {
    recordNav(at("chat", "t1"));
    recordNav(at("calendar"));
    stepNav(-1, all);
    recordNav(at("chat", "t9")); // t1's group resolved to another pane
    expect(canNav(1)).toBe(true); // forward history kept
    expect(stepNav(1, all)).toEqual(at("calendar"));
  });
});
