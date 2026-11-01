import { describe, it, expect } from "vitest";
import { classifyRejection, type CrashSeverity } from "@/debug/model/rejection-severity";

describe("classifyRejection — unhandled promise rejection severity", () => {
  it("logs invoke rejections marked __crashLogged without treating IPC errors as UI crashes", () => {
    const err = Object.assign(new Error("command pty_write not found"), { __crashLogged: true });
    expect(classifyRejection(err)).toBe<CrashSeverity>("log");
  });

  it("generic invoke rejection (string, unmarked) → log", () => {
    expect(classifyRejection("command not found: detect_shells")).toBe<CrashSeverity>("log");
  });

  it("dynamic chunk/load error → crash (the view is broken)", () => {
    const msgs = [
      "Failed to fetch dynamically imported module: http://localhost:1420/src/calendar/calendar-view.tsx",
      "Importing a module script failed.",
      "Unable to preload CSS",
    ];
    for (const m of msgs) {
      expect(classifyRejection(new TypeError(m))).toBe<CrashSeverity>("crash");
    }
  });

  it("random logic rejection (app TypeError) → crash", () => {
    expect(
      classifyRejection(new TypeError("Cannot read properties of undefined (reading 'map')")),
    ).toBe<CrashSeverity>("crash");
  });

  it("reason null/undefined → log (nothing actionable)", () => {
    expect(classifyRejection(null)).toBe<CrashSeverity>("log");
    expect(classifyRejection(undefined)).toBe<CrashSeverity>("log");
  });

  it("AbortError (navigation, normal cancellations) → log", () => {
    expect(
      classifyRejection(new DOMException("The operation was aborted.", "AbortError")),
    ).toBe<CrashSeverity>("log");
  });

  it("logs invoke network errors and IPC fetch/timeouts", () => {
    const netErrs = [
      "Network Error",
      "Failed to fetch",
      "timeout of 30000ms exceeded",
      "Load failed",
    ];
    for (const m of netErrs) {
      expect(classifyRejection(new Error(m))).toBe<CrashSeverity>("log");
    }
  });
});
