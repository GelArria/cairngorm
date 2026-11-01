import { describe, expect, test } from "bun:test";
import { scheduledResult } from "../tui/scheduled";

const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "stop",
});

describe("scheduled results", () => {
  test("requires an actual assistant result", () => {
    expect(scheduledResult([{ role: "user", content: "hello" }]).success).toBe(false);
    expect(scheduledResult([assistant("Done")])).toEqual({ success: true, output: "Done" });
  });
  test("does not turn a provider failure into a successful dispatch", () => {
    expect(
      scheduledResult([
        assistant("Working"),
        { role: "assistant", stopReason: "error", errorMessage: "Quota exceeded" },
      ]),
    ).toEqual({ success: false, output: "Quota exceeded" });
    expect(scheduledResult([{ role: "assistant", stopReason: "aborted" }]).success).toBe(false);
    expect(scheduledResult([{ role: "assistant", stopReason: "toolUse" }]).success).toBe(false);
    expect(scheduledResult([{ role: "assistant", stopReason: "length" }]).success).toBe(false);
  });
  test("returns only the last answer and bounds persisted output", () => {
    expect(
      scheduledResult([
        assistant("Earlier"),
        { role: "toolResult", content: "Tool trace" },
        assistant("Final"),
      ]).output,
    ).toBe("Final");
    expect(scheduledResult([assistant("x".repeat(100_000))]).output.length).toBe(16_000);
  });
});
